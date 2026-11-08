import { DEFAULT_MASTER_TEMPLATE } from './defaultTemplate';
import { supabase } from '../lib/supabase';

function client() {
  if (!supabase) throw new Error('Supabase 연결 설정이 없습니다.');
  return supabase;
}

function throwIfError(error) {
  if (error) throw error;
}

function markLocalWrite() {
  window.__checklistLastWriteAt = Date.now();
}

function baseRecord(row) {
  return { id: row.id, ...row.data, createdAt: row.created_at };
}

function dataOnly(record, excluded = []) {
  const copy = { ...record };
  ['id', 'createdAt', ...excluded].forEach((key) => delete copy[key]);
  return copy;
}

async function getAll(table, map = baseRecord, orderColumn = 'created_at') {
  const { data, error } = await client().from(table).select('*').order(orderColumn);
  throwIfError(error);
  return data.map(map);
}

async function getById(table, id, map = baseRecord) {
  const { data, error } = await client().from(table).select('*').eq('id', id).maybeSingle();
  throwIfError(error);
  return data ? map(data) : undefined;
}

async function insert(table, payload, map = baseRecord) {
  const { data, error } = await client().from(table).insert(payload).select().single();
  throwIfError(error);
  markLocalWrite();
  return map(data);
}

async function update(table, id, payload, map = baseRecord) {
  const { data, error } = await client().from(table).update(payload).eq('id', id).select().single();
  throwIfError(error);
  markLocalWrite();
  return map(data);
}

async function remove(table, id) {
  const { error } = await client().from(table).delete().eq('id', id);
  throwIfError(error);
  markLocalWrite();
}

const mapEquipment = (row) => ({ ...baseRecord(row), folderId: row.folder_id });
const mapChecklist = (row) => ({ ...baseRecord(row), equipmentId: row.equipment_id, templateId: row.template_id });
const mapResult = (row) => ({ ...baseRecord(row), checklistId: row.checklist_id, itemId: row.item_id, updatedAt: row.updated_at });
const mapPhoto = (row) => ({ ...baseRecord(row), resultId: row.result_id });

export const templateDB = {
  getAll: async () => {
    const templates = await getAll('templates');
    if (templates.length > 0) return templates;
    await templateDB.add(DEFAULT_MASTER_TEMPLATE);
    return getAll('templates');
  },
  getById: (id) => getById('templates', id),
  add: async (record) => (await insert('templates', { data: dataOnly(record) })).id,
  put: (record) => update('templates', record.id, { data: dataOnly(record) }),
  delete: (id) => remove('templates', id),
};

export const folderDB = {
  getAll: () => getAll('folders'),
  getById: (id) => getById('folders', id),
  add: async (record) => (await insert('folders', { data: dataOnly(record) })).id,
  put: (record) => update('folders', record.id, { data: dataOnly(record) }),
  delete: (id) => remove('folders', id),
};

export const equipmentDB = {
  getAll: () => getAll('equipments', mapEquipment),
  getByFolderId: async (folderId) => (await getAll('equipments', mapEquipment)).filter((item) => item.folderId === folderId),
  getById: (id) => getById('equipments', id, mapEquipment),
  add: async (record) => (await insert('equipments', {
    folder_id: record.folderId || null,
    data: dataOnly(record, ['folderId']),
  }, mapEquipment)).id,
  put: (record) => update('equipments', record.id, {
    folder_id: record.folderId || null,
    data: dataOnly(record, ['folderId']),
  }, mapEquipment),
  delete: (id) => remove('equipments', id),
};

export const checklistDB = {
  getAll: () => getAll('checklists', mapChecklist),
  getByEquipmentId: async (equipmentId) => (await getAll('checklists', mapChecklist)).filter((item) => item.equipmentId === equipmentId),
  getById: (id) => getById('checklists', id, mapChecklist),
  add: async (record) => (await insert('checklists', {
    equipment_id: record.equipmentId,
    template_id: record.templateId || null,
    data: dataOnly(record, ['equipmentId', 'templateId']),
  }, mapChecklist)).id,
  put: (record) => update('checklists', record.id, {
    equipment_id: record.equipmentId,
    template_id: record.templateId || null,
    data: dataOnly(record, ['equipmentId', 'templateId']),
  }, mapChecklist),
  delete: (id) => remove('checklists', id),
};

export const resultDB = {
  getAll: () => getAll('results', mapResult, 'updated_at'),
  getByChecklistId: async (checklistId) => (await getAll('results', mapResult, 'updated_at')).filter((item) => item.checklistId === checklistId),
  getById: (id) => getById('results', id, mapResult),
  upsert: async (checklistId, itemId, record) => {
    const { data, error } = await client().from('results').upsert({
      checklist_id: checklistId,
      item_id: String(itemId),
      data: dataOnly(record, ['checklistId', 'itemId', 'updatedAt']),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'checklist_id,item_id' }).select().single();
    throwIfError(error);
    markLocalWrite();
    return data.id;
  },
  delete: (id) => remove('results', id),
};

export const photoDB = {
  getByResultId: async (resultId) => (await getAll('photos', mapPhoto)).filter((item) => item.resultId === resultId),
  add: async (record) => (await insert('photos', { result_id: record.resultId, data: dataOnly(record, ['resultId']) }, mapPhoto)).id,
  delete: (id) => remove('photos', id),
};

export async function exportAllData() {
  const [templates, folders, equipments, checklists, results, photos] = await Promise.all([
    templateDB.getAll(), folderDB.getAll(), equipmentDB.getAll(), checklistDB.getAll(), resultDB.getAll(), getAll('photos', mapPhoto),
  ]);
  return { templates, folders, equipments, checklists, results, photos, exportedAt: new Date().toISOString() };
}

export async function importAllData(backup) {
  const records = [
    ['templates', backup.templates, (item) => ({ id: item.id, data: dataOnly(item) })],
    ['folders', backup.folders, (item) => ({ id: item.id, data: dataOnly(item) })],
    ['equipments', backup.equipments, (item) => ({ id: item.id, folder_id: item.folderId || null, data: dataOnly(item, ['folderId']) })],
    ['checklists', backup.checklists, (item) => ({ id: item.id, equipment_id: item.equipmentId, template_id: item.templateId || null, data: dataOnly(item, ['equipmentId', 'templateId']) })],
    ['results', backup.results, (item) => ({ id: item.id, checklist_id: item.checklistId, item_id: String(item.itemId), data: dataOnly(item, ['checklistId', 'itemId', 'updatedAt']) })],
    ['photos', backup.photos, (item) => ({ id: item.id, result_id: item.resultId, data: dataOnly(item, ['resultId']) })],
  ];
  for (const [table, items, map] of records) {
    if (!items?.length) continue;
    const { error } = await client().from(table).upsert(items.map(map));
    throwIfError(error);
  }
  markLocalWrite();
}

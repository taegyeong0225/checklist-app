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

// 전체를 받아 브라우저에서 거르지 않고, DB에서 조건으로 필터링 (인덱스 사용)
async function getWhere(table, column, value, map = baseRecord, orderColumn = 'created_at') {
  const { data, error } = await client().from(table).select('*').eq(column, value).order(orderColumn);
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
  getByFolderId: (folderId) => getWhere('equipments', 'folder_id', folderId, mapEquipment),
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
  // 체크리스트·점검 결과·사진은 FK on delete cascade로 함께 삭제됨
  deleteByFolderId: async (folderId) => {
    const { error } = await client().from('equipments').delete().eq('folder_id', folderId);
    throwIfError(error);
    markLocalWrite();
  },
};

export const checklistDB = {
  getAll: () => getAll('checklists', mapChecklist),
  getByEquipmentId: (equipmentId) => getWhere('checklists', 'equipment_id', equipmentId, mapChecklist),
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
  getByChecklistId: (checklistId) => getWhere('results', 'checklist_id', checklistId, mapResult, 'updated_at'),
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
  getByResultId: (resultId) => getWhere('photos', 'result_id', resultId, mapPhoto),
  // 여러 점검 결과의 사진을 한 번의 요청으로 조회
  getByResultIds: async (resultIds) => {
    if (!resultIds.length) return [];
    const { data, error } = await client().from('photos').select('*').in('result_id', resultIds).order('created_at');
    throwIfError(error);
    return data.map(mapPhoto);
  },
  add: async (record) => (await insert('photos', { result_id: record.resultId, data: dataOnly(record, ['resultId']) }, mapPhoto)).id,
  delete: (id) => remove('photos', id),
};

// 이슈 리스트 (트러블슈팅): { equipmentName, issue, solution, updatedAt }
export const issueDB = {
  getAll: () => getAll('issues'),
  add: async (record) => (await insert('issues', { data: dataOnly(record) })).id,
  put: (record) => update('issues', record.id, { data: dataOnly(record) }),
  delete: (id) => remove('issues', id),
};

/** issues 테이블이 아직 없을 때 (supabase/issues.sql 미실행) */
export const isMissingTableError = (error) => ['42P01', 'PGRST205'].includes(error?.code);

export async function exportAllData() {
  const [templates, folders, equipments, checklists, results, photos, issues] = await Promise.all([
    templateDB.getAll(), folderDB.getAll(), equipmentDB.getAll(), checklistDB.getAll(), resultDB.getAll(), getAll('photos', mapPhoto),
    issueDB.getAll().catch((error) => { if (isMissingTableError(error)) return []; throw error; }),
  ]);
  return { templates, folders, equipments, checklists, results, photos, issues, exportedAt: new Date().toISOString() };
}

export async function importAllData(backup) {
  const records = [
    ['templates', backup.templates, (item) => ({ id: item.id, data: dataOnly(item) })],
    ['folders', backup.folders, (item) => ({ id: item.id, data: dataOnly(item) })],
    ['equipments', backup.equipments, (item) => ({ id: item.id, folder_id: item.folderId || null, data: dataOnly(item, ['folderId']) })],
    ['checklists', backup.checklists, (item) => ({ id: item.id, equipment_id: item.equipmentId, template_id: item.templateId || null, data: dataOnly(item, ['equipmentId', 'templateId']) })],
    ['results', backup.results, (item) => ({ id: item.id, checklist_id: item.checklistId, item_id: String(item.itemId), data: dataOnly(item, ['checklistId', 'itemId', 'updatedAt']) })],
    ['photos', backup.photos, (item) => ({ id: item.id, result_id: item.resultId, data: dataOnly(item, ['resultId']) })],
    ['issues', backup.issues, (item) => ({ id: item.id, data: dataOnly(item) })],
  ];
  for (const [table, items, map] of records) {
    if (!items?.length) continue;
    const { error } = await client().from(table).upsert(items.map(map));
    throwIfError(error);
  }
  markLocalWrite();
}

// IndexedDB 유틸리티 - 모든 데이터를 로컬 기기에 저장
import { DEFAULT_MASTER_TEMPLATE } from './defaultTemplate';

const DB_NAME = 'ChecklistDB';
const DB_VERSION = 2; // 폴더(메인 설비 그룹) 지원을 위해 v2 업그레이드

const STORES = {
  TEMPLATES: 'templates',
  FOLDERS: 'folders',          // 메인 설비 폴더/그룹 (예: SFA GEN2 FCM 3호기)
  EQUIPMENTS: 'equipments',    // 단위 설비 (folderId 소속 또는 단독 설비)
  CHECKLISTS: 'checklists',    // 설비별 체크리스트
  RESULTS: 'results',          // 점검 결과
  PHOTOS: 'photos',            // 현장 사진
};

let db = null;

export function openDB() {
  return new Promise((resolve, reject) => {
    if (db) { resolve(db); return; }
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (e) => {
      const d = e.target.result;

      if (!d.objectStoreNames.contains(STORES.TEMPLATES)) {
        const ts = d.createObjectStore(STORES.TEMPLATES, { keyPath: 'id', autoIncrement: true });
        ts.createIndex('version', 'version', { unique: false });
      }

      if (!d.objectStoreNames.contains(STORES.FOLDERS)) {
        const fs = d.createObjectStore(STORES.FOLDERS, { keyPath: 'id', autoIncrement: true });
        fs.createIndex('name', 'name', { unique: false });
        fs.createIndex('line', 'line', { unique: false });
      }

      if (!d.objectStoreNames.contains(STORES.EQUIPMENTS)) {
        const es = d.createObjectStore(STORES.EQUIPMENTS, { keyPath: 'id', autoIncrement: true });
        es.createIndex('name', 'name', { unique: false });
        es.createIndex('line', 'line', { unique: false });
        es.createIndex('folderId', 'folderId', { unique: false });
      } else {
        const es = req.transaction.objectStore(STORES.EQUIPMENTS);
        if (!es.indexNames.contains('folderId')) {
          es.createIndex('folderId', 'folderId', { unique: false });
        }
      }

      if (!d.objectStoreNames.contains(STORES.CHECKLISTS)) {
        const cs = d.createObjectStore(STORES.CHECKLISTS, { keyPath: 'id', autoIncrement: true });
        cs.createIndex('equipmentId', 'equipmentId', { unique: false });
        cs.createIndex('templateId', 'templateId', { unique: false });
      }

      if (!d.objectStoreNames.contains(STORES.RESULTS)) {
        const rs = d.createObjectStore(STORES.RESULTS, { keyPath: 'id', autoIncrement: true });
        rs.createIndex('checklistId', 'checklistId', { unique: false });
        rs.createIndex('itemId', 'itemId', { unique: false });
      }

      if (!d.objectStoreNames.contains(STORES.PHOTOS)) {
        const ps = d.createObjectStore(STORES.PHOTOS, { keyPath: 'id', autoIncrement: true });
        ps.createIndex('resultId', 'resultId', { unique: false });
      }
    };

    req.onsuccess = (e) => { db = e.target.result; resolve(db); };
    req.onerror = (e) => reject(e.target.error);
  });
}

function txStore(storeName, mode = 'readonly') {
  return db.transaction(storeName, mode).objectStore(storeName);
}

function promReq(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function getAll(storeName, indexName, value) {
  return openDB().then(() => {
    const store = txStore(storeName, 'readonly');
    if (indexName && value !== undefined) {
      return promReq(store.index(indexName).getAll(value));
    }
    return promReq(store.getAll());
  });
}

function getById(storeName, id) {
  return openDB().then(() => promReq(txStore(storeName, 'readonly').get(id)));
}

function add(storeName, data) {
  return openDB().then(() => promReq(txStore(storeName, 'readwrite').add(data)));
}

function put(storeName, data) {
  return openDB().then(() => promReq(txStore(storeName, 'readwrite').put(data)));
}

function del(storeName, id) {
  return openDB().then(() => promReq(txStore(storeName, 'readwrite').delete(id)));
}

// ───── Templates ─────
export const templateDB = {
  getAll: async () => {
    const list = await getAll(STORES.TEMPLATES);
    if (!list || list.length === 0) {
      const id = await add(STORES.TEMPLATES, {
        ...DEFAULT_MASTER_TEMPLATE,
        createdAt: new Date().toISOString(),
      });
      const initial = await getById(STORES.TEMPLATES, id);
      return [initial];
    }
    return list;
  },
  getById: (id) => getById(STORES.TEMPLATES, id),
  add: (data) => add(STORES.TEMPLATES, { ...data, createdAt: new Date().toISOString() }),
  put: (data) => put(STORES.TEMPLATES, data),
  delete: (id) => del(STORES.TEMPLATES, id),
};

// ───── Folders (메인 설비 그룹) ─────
export const folderDB = {
  getAll: () => getAll(STORES.FOLDERS),
  getById: (id) => getById(STORES.FOLDERS, id),
  add: (data) => add(STORES.FOLDERS, { ...data, createdAt: new Date().toISOString() }),
  put: (data) => put(STORES.FOLDERS, data),
  delete: async (id) => {
    // 소속된 하위 설비들의 folderId를 null로 해제
    const eqs = await getAll(STORES.EQUIPMENTS);
    for (const eq of eqs) {
      if (eq.folderId === id) {
        await put(STORES.EQUIPMENTS, { ...eq, folderId: null });
      }
    }
    return del(STORES.FOLDERS, id);
  },
};

// ───── Equipments (단위 설비) ─────
export const equipmentDB = {
  getAll: () => getAll(STORES.EQUIPMENTS),
  getByFolderId: (folderId) => getAll(STORES.EQUIPMENTS, 'folderId', folderId),
  getById: (id) => getById(STORES.EQUIPMENTS, id),
  add: (data) => add(STORES.EQUIPMENTS, { ...data, createdAt: new Date().toISOString() }),
  put: (data) => put(STORES.EQUIPMENTS, data),
  delete: async (id) => {
    // 체크리스트 및 결과 삭제
    const cls = await checklistDB.getByEquipmentId(id);
    for (const cl of cls) {
      await checklistDB.delete(cl.id);
    }
    return del(STORES.EQUIPMENTS, id);
  },
};

// ───── Checklists ─────
export const checklistDB = {
  getAll: () => getAll(STORES.CHECKLISTS),
  getByEquipmentId: (equipmentId) => getAll(STORES.CHECKLISTS, 'equipmentId', equipmentId),
  getById: (id) => getById(STORES.CHECKLISTS, id),
  add: (data) => add(STORES.CHECKLISTS, { ...data, createdAt: new Date().toISOString() }),
  put: (data) => put(STORES.CHECKLISTS, data),
  delete: async (id) => {
    const rs = await resultDB.getByChecklistId(id);
    for (const r of rs) {
      await resultDB.delete(r.id);
    }
    return del(STORES.CHECKLISTS, id);
  },
};

// ───── Results ─────
export const resultDB = {
  getAll: () => getAll(STORES.RESULTS),
  getByChecklistId: (checklistId) => getAll(STORES.RESULTS, 'checklistId', checklistId),
  getById: (id) => getById(STORES.RESULTS, id),
  add: (data) => add(STORES.RESULTS, { ...data, updatedAt: new Date().toISOString() }),
  put: (data) => put(STORES.RESULTS, { ...data, updatedAt: new Date().toISOString() }),
  delete: async (id) => {
    const ps = await photoDB.getByResultId(id);
    for (const p of ps) {
      await photoDB.delete(p.id);
    }
    return del(STORES.RESULTS, id);
  },
  upsert: async (checklistId, itemId, data) => {
    await openDB();
    const all = await getAll(STORES.RESULTS, 'checklistId', checklistId);
    const existing = all.find((r) => String(r.itemId) === String(itemId));
    const record = {
      ...data,
      checklistId,
      itemId,
      updatedAt: new Date().toISOString(),
    };
    if (existing) {
      record.id = existing.id;
      record.createdAt = existing.createdAt;
      return put(STORES.RESULTS, record);
    }
    record.createdAt = new Date().toISOString();
    return add(STORES.RESULTS, record);
  },
};

// ───── Photos ─────
export const photoDB = {
  getByResultId: (resultId) => getAll(STORES.PHOTOS, 'resultId', resultId),
  add: (data) => add(STORES.PHOTOS, { ...data, createdAt: new Date().toISOString() }),
  delete: (id) => del(STORES.PHOTOS, id),
};

// ───── Backup / Restore ─────
export async function exportAllData() {
  await openDB();
  const [templates, folders, equipments, checklists, results, photos] = await Promise.all([
    getAll(STORES.TEMPLATES),
    getAll(STORES.FOLDERS),
    getAll(STORES.EQUIPMENTS),
    getAll(STORES.CHECKLISTS),
    getAll(STORES.RESULTS),
    getAll(STORES.PHOTOS),
  ]);
  return { templates, folders, equipments, checklists, results, photos, exportedAt: new Date().toISOString() };
}

export async function importAllData(backup) {
  await openDB();
  const stores = [
    [STORES.TEMPLATES, backup.templates],
    [STORES.FOLDERS, backup.folders],
    [STORES.EQUIPMENTS, backup.equipments],
    [STORES.CHECKLISTS, backup.checklists],
    [STORES.RESULTS, backup.results],
    [STORES.PHOTOS, backup.photos],
  ];
  for (const [storeName, records] of stores) {
    if (!records) continue;
    for (const rec of records) {
      await put(storeName, rec);
    }
  }
}

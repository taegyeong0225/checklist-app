// 진행률 계산 및 동기화 유틸
import { DEFAULT_MASTER_TEMPLATE } from './defaultTemplate';

const normKey = (text) => String(text || '').replace(/s+/g, ' ').trim();

/**
 * 엑셀 재업로드 등으로 항목 ID가 ITEM_구분_항목명 형태로 새로 생성된 경우,
 * 같은 구분/항목명을 가진 기존 ID(이전 템플릿 또는 기본 MMI-xxx ID)로 되돌린다.
 * → 기존 점검 결과(results.item_id)와의 연결 유지
 */
export function preserveTemplateItemIds(template, previousTemplate = null) {
  if (!template) return template;
  const byCatName = new Map();
  const byName = new Map();
  // keepGenerated: 이전 템플릿의 ITEM_ ID도 기억 (앱에서 추가한 항목은 ITEM_..._시간값 형태라 이름으로 재생성되지 않음)
  const register = (tpl, keepGenerated = false) => {
    for (const cat of (tpl?.categories || [])) {
      for (const item of (cat.items || [])) {
        const rawId = String(item.id || '');
        if (!rawId || rawId.startsWith('LEGACY_') || (!keepGenerated && rawId.startsWith('ITEM_'))) continue;
        const k = normKey(cat.name) + '|' + normKey(item.name);
        if (!byCatName.has(k)) byCatName.set(k, String(item.id));
        const n = normKey(item.name);
        byName.set(n, byName.has(n) && byName.get(n) !== String(item.id) ? null : String(item.id));
      }
    }
  };
  register(previousTemplate, true);
  register(DEFAULT_MASTER_TEMPLATE);

  let changed = false;
  const categories = (template.categories || []).map((cat) => {
    const used = new Set();
    const items = (cat.items || []).map((item) => {
      const id = String(item.id || '');
      if (id && !id.startsWith('ITEM_') && !id.startsWith('LEGACY_')) return item;
      const legacy = byCatName.get(normKey(cat.name) + '|' + normKey(item.name)) || byName.get(normKey(item.name));
      if (!legacy || legacy === id || used.has(legacy)) return item;
      used.add(legacy);
      changed = true;
      return { ...item, id: legacy };
    });
    return { ...cat, items };
  });
  return changed ? { ...template, categories } : template;
}

/** 필수 열이 N인 항목만 선택 항목. 값이 없는 기존 템플릿은 모두 필수로 취급 */
export const isRequiredItem = (item) => item?.required !== false;

/** 엑셀 필수 값(Y/N) → boolean. 비어 있으면 필수 */
export const parseRequired = (value) => String(value ?? '').trim().toUpperCase() !== 'N';

/** 카테고리를 켤 때 기본으로 체크할 항목: 필수 항목 (필수가 하나도 없으면 전체) */
export function defaultCategoryItemIds(cat) {
  const items = cat?.items || [];
  const required = items.filter(isRequiredItem);
  return (required.length > 0 ? required : items).map((i) => i.id);
}

/** 신규 설비 기본 선택: 필수 항목만 체크 */
export function defaultInclusion(template) {
  const cats = (template?.categories || []).filter((c) => (c.items || []).some(isRequiredItem));
  return {
    includedCategories: cats.map((c) => c.name),
    includedItemIds: cats.flatMap((c) => c.items.filter(isRequiredItem).map((i) => i.id)),
  };
}

/** 점검 완료로 보는 상태 (pending 제외) */
export const CHECKED_STATUSES = ['ok', 'ng', 'na'];

/** itemIds에 해당하는 항목의 '신규 추가'(isNewlyAdded) 표시 제거. 바뀐 게 없으면 원본 그대로 반환 */
export function clearNewlyAddedFlags(checklist, itemIds) {
  let changed = false;
  const categories = (checklist?.categories || []).map((cat) => {
    let catChanged = false;
    const items = (cat.items || []).map((item) => {
      if (!item.isNewlyAdded || !itemIds.has(String(item.id))) return item;
      catChanged = true;
      const { isNewlyAdded: _removed, ...rest } = item;
      return rest;
    });
    if (!catChanged) return cat;
    changed = true;
    return { ...cat, items };
  });
  return changed ? { ...checklist, categories } : checklist;
}

export function calcProgress(checklist, results) {
  let total = 0;
  let done = 0;
  let ng = 0;
  let pending = 0;

  for (const cat of (checklist?.categories || [])) {
    for (const item of (cat.items || [])) {
      total++;
      const r = results.find((r) => String(r.itemId) === String(item.id));
      const status = r?.status || 'pending';
      if (status === 'ok' || status === 'ng' || status === 'na') done++;
      if (status === 'ng') ng++;
      if (status === 'pending' || !r) pending++;
    }
  }

  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  return { total, done, ng, pending, pct };
}

export function statusColor(status) {
  switch (status) {
    case 'ok': return 'var(--color-ok)';
    case 'ng': return 'var(--color-ng)';
    case 'na': return 'var(--color-na)';
    default:   return 'var(--color-pending)';
  }
}

export function statusLabel(status) {
  switch (status) {
    case 'ok': return '정상';
    case 'ng': return '이상';
    case 'na': return '해당없음';
    default:   return '미점검';
  }
}

export function formatDateTime(isoStr) {
  if (!isoStr) return '-';
  return new Date(isoStr).toLocaleString('ko-KR', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

/**
 * 🌟 핵심 기능: 설비 체크리스트를 최신 마스터 템플릿과 자동 동기화/병합
 *
 * 사용자가 마스터 엑셀에 행을 삽입(예: PC 세팅에 새 항목 추가)하면,
 * 이미 만들어진 설비의 체크리스트에도 신규 항목이 자동으로 삽입됩니다.
 *
 * - 기존 입력 결과(정상/이상/비고/사진)는 100% 온전히 유지
 * - 신규 항목은 pending(미점검) 상태로 해당 카테고리 내 알맞은 위치에 추가
 * - 설비가 포함하고 있는 카테고리만 동기화 대상에 포함
 */
export function syncChecklistWithTemplate(checklist, rawTemplate, equipment, resultItemIds = null) {
  if (!checklist || !rawTemplate) return { updatedChecklist: checklist, addedCount: 0, addedItemIds: [], restoredCount: 0, changed: false };
  const template = preserveTemplateItemIds(rawTemplate);
  const originalChecklist = checklist;
  // 이전 버전에서 잘못 생성된 '복구된 항목' 카테고리 제거
  checklist = {
    ...checklist,
    categories: (checklist.categories || []).filter((c) => c.name !== '복구된 항목'),
  };

  // 설비에 지정된 포함 카테고리 목록
  const incCats = equipment?.includedCategories && equipment.includedCategories.length > 0
    ? new Set(equipment.includedCategories)
    : null; // null이면 템플릿 전체 포함
  const recoveryMode = (checklist.categories || []).length === 0 && (template.categories || []).length > 0;
  const matchedCategoryCount = incCats
    ? (template.categories || []).filter((category) => incCats.has(category.name)).length
    : 0;
  const selectedCats = !recoveryMode && incCats && matchedCategoryCount === incCats.size
    ? incCats
    : null;
  const incItemIds = incCats && Array.isArray(equipment?.includedItemIds)
    ? new Set(equipment.includedItemIds.map(String))
    : null;
  const excludedItemIds = new Set((checklist.excludedItemIds || []).map(String));
  const existingItemIds = (checklist.categories || []).flatMap((c) => (c.items || []).map((i) => String(i.id)));

  // 이 체크리스트가 이미 "알고 있던" 템플릿 항목 ID.
  // 처음 보는 항목 = 템플릿에 새로 추가된 항목 → 자동 추가
  // 알던 항목인데 포함 목록에 없음 = 사용자가 설비 설정에서 체크 해제한 항목 → 제외
  const knownIds = new Set(
    Array.isArray(checklist.knownTemplateItemIds)
      ? checklist.knownTemplateItemIds.map(String)
      : [...(incItemIds || []), ...existingItemIds, ...excludedItemIds]
  );
  const isDeselected = (itemId) => !recoveryMode && incItemIds && knownIds.has(itemId) && !incItemIds.has(itemId);
  const allTemplateItemIds = (template.categories || []).flatMap((cat) =>
    (cat.items || []).map((item) => String(item.id || `ITEM_${cat.name}_${item.name}`))
  );

  const updatedCategories = [];
  let addedCount = 0;
  const addedItemIds = [];

  for (const tplCat of (template.categories || [])) {
    // 설비에서 해당 카테고리를 제외한 경우 스킵
    if (selectedCats && !selectedCats.has(tplCat.name)) continue;

    // 기존 체크리스트에서 동일 카테고리 탐색
    const existCat = (checklist.categories || []).find((c) => c.name === tplCat.name);
    const existMap = new Map();
    if (existCat && existCat.items) {
      for (const item of existCat.items) {
        if (item.id) existMap.set(String(item.id), item);
        if (item.name) existMap.set(item.name, item);
      }
    }

    const mergedItems = [];
    for (const tplItem of (tplCat.items || [])) {
      const itemId = String(tplItem.id || `ITEM_${tplCat.name}_${tplItem.name}`);
      const existing = (tplItem.id && existMap.get(String(tplItem.id))) || existMap.get(tplItem.name);
      // 기존 항목은 항상 유지, 신규 항목만 제외 여부 판단
      if (!existing && (isDeselected(itemId) || (!recoveryMode && excludedItemIds.has(itemId)))) continue;
      // 선택(필수 N) 항목은 설비 설정에서 직접 체크한 경우에만 추가
      if (!existing && !isRequiredItem(tplItem) && !(incItemIds && incItemIds.has(itemId))) continue;

      if (existing) {
        // 기존 점검 항목 유지 (최신 기준/설명만 갱신)
        // 이름으로 매칭된 기존 항목의 ID가 템플릿 ID와 다르면,
        // 점검 결과가 남아있는 쪽 ID를 사용 (기록 연결 유지)
        const existingHasResult = resultItemIds?.has(String(existing.id));
        const tplHasResult = resultItemIds?.has(String(tplItem.id));
        const keepExistingId = existing.id && (!tplItem.id || (existingHasResult && !tplHasResult));
        mergedItems.push({
          ...tplItem,
          id: keepExistingId ? existing.id : tplItem.id,
          criteria: tplItem.criteria || existing.criteria || '',
          note: tplItem.note || existing.note || '',
          ...(existing.isNewlyAdded && String(existing.id) === String(keepExistingId ? existing.id : tplItem.id) ? { isNewlyAdded: true } : {}),
        });
      } else {
        // ✨ 새롭게 행 삽입된 항목 발견! 자동 추가
        mergedItems.push({
          ...tplItem,
          id: tplItem.id || `ITEM_${tplCat.name}_${tplItem.name}`,
          criteria: tplItem.criteria || '',
          note: tplItem.note || '',
          isNewlyAdded: true, // 신규 추가 플래그
        });
        addedItemIds.push(itemId);
        addedCount++;
      }
    }

    if (existCat) {
      for (const existingItem of existCat.items || []) {
        if (!mergedItems.some((item) => String(item.id) === String(existingItem.id) || (existingItem.name && item.name === existingItem.name))) {
          mergedItems.push(existingItem);
        }
      }
    }

    if (mergedItems.length > 0) {
      updatedCategories.push({
        ...tplCat,
        items: mergedItems,
      });
    }
  }

  for (const existingCategory of checklist.categories || []) {
    if (!updatedCategories.some((category) => category.name === existingCategory.name)) {
      updatedCategories.push(existingCategory);
    }
  }

  // 🛟 점검 결과(상태/비고/사진)가 남아있는데 체크리스트에서 빠진 항목 복구
  let restoredCount = 0;
  if (resultItemIds && resultItemIds.size > 0) {
    const presentIds = new Set(updatedCategories.flatMap((c) => (c.items || []).map((i) => String(i.id))));
    const missing = new Set([...resultItemIds].map(String).filter((id) => !presentIds.has(id)));
    for (const tplCat of (template.categories || [])) {
      for (const tplItem of (tplCat.items || [])) {
        const itemId = String(tplItem.id || `ITEM_${tplCat.name}_${tplItem.name}`);
        if (!missing.has(itemId)) continue;
        let cat = updatedCategories.find((c) => c.name === tplCat.name);
        if (!cat) {
          cat = { ...tplCat, items: [] };
          updatedCategories.push(cat);
        }
        cat.items = [...cat.items, { ...tplItem, id: itemId }];
        missing.delete(itemId);
        restoredCount++;
      }
    }
  }

  if (updatedCategories.length === 0 && (checklist.categories || []).length > 0 && (template.categories || []).length > 0) {
    return { updatedChecklist: checklist, addedCount: 0, addedItemIds: [], restoredCount: 0, changed: false };
  }

  const changed = JSON.stringify(originalChecklist.categories || []) !== JSON.stringify(updatedCategories)
    || checklist.templateVersion !== template.version
    || checklist.templateName !== template.name
    || JSON.stringify(checklist.knownTemplateItemIds || null) !== JSON.stringify(allTemplateItemIds);
  const updatedChecklist = {
    ...checklist,
    categories: updatedCategories,
    knownTemplateItemIds: allTemplateItemIds,
    templateVersion: template.version,
    templateName: template.name,
    lastSyncedAt: changed ? new Date().toISOString() : checklist.lastSyncedAt,
  };

  return { updatedChecklist, addedCount, addedItemIds, restoredCount, changed };
}

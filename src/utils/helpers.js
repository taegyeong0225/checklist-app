// 진행률 계산 및 동기화 유틸

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
export function syncChecklistWithTemplate(checklist, template, equipment) {
  if (!checklist || !template) return { updatedChecklist: checklist, addedCount: 0 };

  // 설비에 지정된 포함 카테고리 목록
  const incCats = equipment?.includedCategories && equipment.includedCategories.length > 0
    ? new Set(equipment.includedCategories)
    : null; // null이면 템플릿 전체 포함

  const updatedCategories = [];
  let addedCount = 0;

  for (const tplCat of (template.categories || [])) {
    // 설비에서 해당 카테고리를 제외한 경우 스킵
    if (incCats && !incCats.has(tplCat.name)) continue;

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
      const existing = (tplItem.id && existMap.get(String(tplItem.id))) || existMap.get(tplItem.name);

      if (existing) {
        // 기존 점검 항목 유지 (최신 기준/설명만 갱신)
        mergedItems.push({
          ...tplItem,
          id: existing.id || tplItem.id,
          criteria: tplItem.criteria || existing.criteria || '',
          note: tplItem.note || existing.note || '',
        });
      } else {
        // ✨ 새롭게 행 삽입된 항목 발견! 자동 추가
        mergedItems.push({
          ...tplItem,
          id: tplItem.id || `ITEM_${tplCat.name}_${tplItem.name}`,
          isNewlyAdded: true, // 신규 추가 플래그
        });
        addedCount++;
      }
    }

    if (mergedItems.length > 0) {
      updatedCategories.push({
        ...tplCat,
        items: mergedItems,
      });
    }
  }

  const updatedChecklist = {
    ...checklist,
    categories: updatedCategories,
    templateVersion: template.version,
    templateName: template.name,
    lastSyncedAt: new Date().toISOString(),
  };

  return { updatedChecklist, addedCount };
}

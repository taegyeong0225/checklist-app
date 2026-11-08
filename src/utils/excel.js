import * as XLSX from 'xlsx';
import { parseCsvToTemplate } from './defaultTemplate';
import { parseRequired } from './helpers';

/**
 * 엑셀 또는 CSV 파일을 읽어 템플릿 구조로 변환
 * 1) "구분,순서,체크 항목..." 확정 헤더 형식 (최우선)
 * 2) "■ 카테고리명" 형식 (호환)
 */
export async function parseTemplateFile(file) {
  const isCsv = file.name.endsWith('.csv');

  if (isCsv) {
    const text = await file.text();
    const tplName = file.name.replace(/\.[^.]+$/, '');
    return parseCsvToTemplate(text, tplName);
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target.result, { type: 'array' });
        const sheetName = wb.SheetNames[0];
        const ws = wb.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

        // 헤더 행 찾기
        let headerRowIdx = -1;
        let colMap = {};

        for (let r = 0; r < Math.min(rows.length, 10); r++) {
          const row = rows[r];
          const rowStr = row.join(';');
          if (rowStr.includes('구분') && rowStr.includes('체크 항목')) {
            headerRowIdx = r;
            row.forEach((col, idx) => {
              const name = String(col).trim();
              if (name) colMap[name] = idx;
            });
            break;
          }
        }

        // 1) "구분, 순서, 체크 항목..." 표준 형식인 경우
        if (headerRowIdx !== -1 && colMap['구분'] !== undefined && colMap['체크 항목'] !== undefined) {
          const categoriesMap = new Map();
          for (let r = headerRowIdx + 1; r < rows.length; r++) {
            const row = rows[r];
            if (!row || row.every((c) => c === '')) continue;

            const categoryName = String(row[colMap['구분']] || '').trim();
            const itemName = String(row[colMap['체크 항목']] || '').trim();
            if (!categoryName || !itemName) continue;

            const itemId = colMap['item_id'] !== undefined && row[colMap['item_id']]
              ? String(row[colMap['item_id']]).trim()
              : `ITEM_${categoryName}_${itemName}`;

            const orderVal = colMap['순서'] !== undefined ? parseInt(row[colMap['순서']], 10) : 0;
            const note = colMap['비고'] !== undefined ? String(row[colMap['비고']] || '').trim() : '';
            const issue = colMap['이슈사항'] !== undefined ? String(row[colMap['이슈사항']] || '').trim() : '';
            const required = colMap['필수'] !== undefined ? parseRequired(row[colMap['필수']]) : true;

            if (!categoriesMap.has(categoryName)) {
              categoriesMap.set(categoryName, {
                name: categoryName,
                categoryId: colMap['category_id'] ? String(row[colMap['category_id']] || '').trim() : categoryName,
                items: [],
              });
            }

            const cat = categoriesMap.get(categoryName);
            cat.items.push({
              id: itemId,
              name: itemName,
              criteria: note || issue || '',
              note,
              issue,
              required,
              order: isNaN(orderVal) ? cat.items.length + 1 : orderVal,
              inputType: 'status',
            });
          }

          resolve({
            name: file.name.replace(/\.[^.]+$/, ''),
            version: 'v1.0',
            categories: Array.from(categoriesMap.values()),
          });
          return;
        }

        // 2) 레거시 형식 (■ 카테고리명 등)
        const categories = [];
        let currentCategory = null;
        let fallbackItemId = 1;

        for (let i = 0; i < rows.length; i++) {
          const row = rows[i];
          if (!row || row.every((c) => c === '')) continue;

          const col0 = String(row[0] || '').trim();
          if (!col0) continue;
          if (col0 === '체크 항목' || col0 === '항목명' || col0 === 'No') continue;

          if (col0.startsWith('■')) {
            const catName = col0.replace(/^■\s*/, '').trim();
            currentCategory = { name: catName, items: [] };
            categories.push(currentCategory);
            continue;
          }

          const restEmpty = row.slice(1).every((c) => String(c || '').trim() === '');
          if (restEmpty && !currentCategory) {
            currentCategory = { name: col0, items: [] };
            categories.push(currentCategory);
            continue;
          }

          if (!currentCategory) {
            currentCategory = { name: '기본 점검', items: [] };
            categories.push(currentCategory);
          }

          let criteria = '';
          for (let c = 1; c < row.length; c++) {
            const val = String(row[c] || '').trim();
            if (val && !['정상', '이상', '상태', '비고', '사진'].includes(val)) {
              criteria = val;
              break;
            }
          }

          currentCategory.items.push({
            id: `LEGACY_${fallbackItemId++}`,
            name: col0,
            criteria,
            inputType: 'status',
            order: currentCategory.items.length,
          });
        }

        resolve({
          name: file.name.replace(/\.[^.]+$/, ''),
          version: 'v1.0',
          categories: categories.filter((c) => c.items.length > 0),
        });
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

/**
 * 점검 결과를 엑셀로 내보내기 (확정 포맷 호환)
 */
export function exportChecklistToExcel(equipment, checklist, results) {
  const wb = XLSX.utils.book_new();

  // 설비 요약 정보
  const headerRows = [
    ['설비명', equipment.name, '', '모델', equipment.model || ''],
    ['호기', equipment.unit ? `${equipment.unit}호기` : '', '', '라인', equipment.line || ''],
    ['위치', equipment.location || '', '', '점검일', new Date().toLocaleDateString('ko-KR')],
    [],
    ['구분 (카테고리)', '순서', '체크 항목', '확인 기준 / 비고', '점검 상태', '측정값', '작업자 비고', '확인 시각'],
  ];

  const dataRows = [];
  for (const category of checklist.categories) {
    (category.items || []).forEach((item, idx) => {
      const result = results.find((r) => String(r.itemId) === String(item.id)) || {};
      dataRows.push([
        category.name,
        item.order || idx + 1,
        item.name,
        item.criteria || item.note || '',
        statusLabel(result.status),
        result.value || '',
        result.note || '',
        result.updatedAt ? new Date(result.updatedAt).toLocaleString('ko-KR') : '',
      ]);
    });
  }

  const ws = XLSX.utils.aoa_to_sheet([...headerRows, ...dataRows]);

  ws['!cols'] = [
    { wch: 18 }, { wch: 8 }, { wch: 34 }, { wch: 30 },
    { wch: 10 }, { wch: 12 }, { wch: 24 }, { wch: 20 },
  ];

  XLSX.utils.book_append_sheet(wb, ws, '점검결과');
  XLSX.writeFile(wb, `${equipment.name}_점검결과_${formatDate(new Date())}.xlsx`);
}

/**
 * 사이트에서 편집한 마스터 템플릿을 다시 가져올 수 있는 엑셀 형식으로 내보낸다.
 */
export function exportTemplateToExcel(template) {
  const wb = XLSX.utils.book_new();
  const rows = [[
    '구분', '순서', '체크 항목', '확인사항', '비고', '필수',
    'item_id', 'category_id', 'sort_order', 'source_row', 'active',
  ]];

  for (const category of template.categories || []) {
    (category.items || []).forEach((item, index) => {
      rows.push([
        category.name,
        item.order || index + 1,
        item.name || '',
        item.criteria || '',
        item.note || '',
        item.required === false ? 'N' : 'Y',
        item.id || '',
        category.categoryId || category.name,
        item.order || index + 1,
        '',
        'Y',
      ]);
    });
  }

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [
    { wch: 22 }, { wch: 8 }, { wch: 42 }, { wch: 34 }, { wch: 22 }, { wch: 8 },
    { wch: 20 }, { wch: 20 }, { wch: 12 }, { wch: 12 }, { wch: 10 },
  ];
  XLSX.utils.book_append_sheet(wb, ws, 'MMI 셋업 리스트');
  const safeName = (template.name || 'MMI_셋업_리스트').replace(/[\\/:*?"<>|]/g, '_');
  XLSX.writeFile(wb, `${safeName}_${formatDate(new Date())}.xlsx`);
}

function statusLabel(status) {
  const map = { ok: '정상', ng: '이상', na: '해당없음', pending: '미점검' };
  return map[status] || '미점검';
}

function formatDate(d) {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

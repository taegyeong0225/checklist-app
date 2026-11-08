// 템플릿 관리 페이지 (설비 자동 일괄 동기화 지원)
import { useEffect, useState } from 'react';
import { templateDB, checklistDB, equipmentDB, resultDB } from '../utils/db';
import { parseTemplateFile, exportTemplateToExcel } from '../utils/excel';
import { syncChecklistWithTemplate, formatDateTime, preserveTemplateItemIds } from '../utils/helpers';
import { useToast } from '../components/ToastProvider';
import { Plus, Upload, Pencil, Trash2, ChevronDown, ChevronRight, ClipboardList, FileText, Download } from 'lucide-react';

const EMPTY_ITEM = { name: '', criteria: '', inputType: 'status', order: 0, required: true };

export default function TemplateManager() {
  const [templates, setTemplates] = useState([]);
  const [selected, setSelected] = useState(null);
  const [collapsed, setCollapsed] = useState({});
  const [showNewCatModal, setShowNewCatModal] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const [showItemModal, setShowItemModal] = useState(null);
  const [itemForm, setItemForm] = useState(EMPTY_ITEM);
  const addToast = useToast();

  useEffect(() => { load(); }, []);

  async function load() {
    const tpls = await templateDB.getAll();
    setTemplates(tpls);
    if (!selected && tpls.length > 0) {
      setSelected(JSON.parse(JSON.stringify(tpls[0])));
    }
  }

  // 기존 설비 체크리스트들에 템플릿 변경사항(행 삽입/신규 항목) 일괄 동기화
  async function syncAllChecklistsWithTemplate(templateObj) {
    const [allCls, allEqs, allResults] = await Promise.all([
      checklistDB.getAll(),
      equipmentDB.getAll(),
      resultDB.getAll(),
    ]);

    let totalUpdated = 0;
    let totalItemsAdded = 0;

    for (const cl of allCls) {
      // 해당 템플릿을 사용 중인 체크리스트
      if (cl.templateId === templateObj.id || !cl.templateId) {
        const eq = allEqs.find((e) => e.id === cl.equipmentId);
        const resultIds = new Set(allResults.filter((r) => r.checklistId === cl.id).map((r) => String(r.itemId)));
        const { updatedChecklist, addedCount, addedItemIds, changed } = syncChecklistWithTemplate(cl, templateObj, eq, resultIds);
        if (changed) {
          await checklistDB.put(updatedChecklist);
          // 설비 설정 화면에도 신규 항목이 체크된 상태로 보이도록 포함 목록 갱신
          if (eq && Array.isArray(eq.includedItemIds) && addedItemIds.length > 0) {
            eq.includedItemIds = [...new Set([...eq.includedItemIds.map(String), ...addedItemIds])];
            await equipmentDB.put(eq);
          }
          totalUpdated++;
          totalItemsAdded += addedCount;
        }
      }
    }

    return { totalUpdated, totalItemsAdded };
  }

  async function handleFileUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    try {
      let parsed = await parseTemplateFile(file);
      // 버전 계산
      const existing = templates.find((t) => t.name === parsed.name);
      let version = 'v1.0';
      if (existing) {
        const verNum = parseFloat((existing.version || 'v1.0').replace('v', '')) + 0.1;
        version = `v${verNum.toFixed(1)}`;
      }
      parsed.version = version;
      // 기존 항목 ID 유지 (ID가 바뀌면 설비 점검 결과와 연결이 끊어짐)
      parsed = preserveTemplateItemIds(parsed, existing);

      let savedId;
      if (existing) {
        await templateDB.put({ ...existing, ...parsed });
        savedId = existing.id;
      } else {
        savedId = await templateDB.add(parsed);
      }

      const updatedTpl = await templateDB.getById(savedId);

      // 🌟 기존 설비들에 신규 삽입된 항목 일괄 동기화
      const { totalUpdated, totalItemsAdded } = await syncAllChecklistsWithTemplate(updatedTpl);

      addToast(`템플릿 "${parsed.name}"을 반영했습니다. (${version})`, 'success');
      if (totalUpdated > 0) {
        addToast(`✨ 기존 ${totalUpdated}개 설비 시트에 템플릿 변경사항을 반영했습니다.${totalItemsAdded ? ` 신규 항목 ${totalItemsAdded}개 포함` : ''}`, 'success', 5000);
      }

      load();
      handleSelectTemplate(updatedTpl);
    } catch (err) {
      console.error(err);
      addToast('파일 가져오기 실패 - 올바른 엑셀/CSV 파일인지 확인하세요.', 'error');
    }
    e.target.value = '';
  }

  async function handleDelete(tpl) {
    if (!confirm(`"${tpl.name}" 템플릿을 삭제하시겠습니까?`)) return;
    await templateDB.delete(tpl.id);
    if (selected?.id === tpl.id) setSelected(null);
    addToast('템플릿을 삭제했습니다.');
    load();
  }

  function handleSelectTemplate(tpl) {
    setSelected(JSON.parse(JSON.stringify(tpl)));
    setCollapsed({});
  }

  async function handleSaveTemplate() {
    if (!selected) return;
    const verNum = parseFloat((selected.version || 'v1.0').replace('v', '')) + 0.1;
    const updated = { ...selected, version: `v${verNum.toFixed(1)}` };
    await templateDB.put(updated);

    // 기존 설비들에 일괄 자동 반영
    const { totalUpdated, totalItemsAdded } = await syncAllChecklistsWithTemplate(updated);

    addToast(`템플릿을 저장했습니다. (${updated.version})`, 'success');
    if (totalUpdated > 0) {
      addToast(`✨ 기존 ${totalUpdated}개 설비 시트에 템플릿 변경사항을 반영했습니다.${totalItemsAdded ? ` 신규 항목 ${totalItemsAdded}개 포함` : ''}`, 'success', 5000);
    }

    load();
    setSelected(updated);
  }

  function handleExportTemplate() {
    if (!selected) return;
    exportTemplateToExcel(selected);
    addToast('현재 템플릿을 엑셀 파일로 내보냈습니다.', 'success');
  }


  async function handleCreateBlank() {
    const name = prompt('새 템플릿 이름을 입력하세요:');
    if (!name) return;
    const id = await templateDB.add({ name, version: 'v1.0', categories: [] });
    addToast(`템플릿 "${name}"을 생성했습니다.`, 'success');
    const tpl = await templateDB.getById(id);
    load();
    handleSelectTemplate(tpl);
  }

  function addCategory() {
    if (!newCatName.trim()) return;
    setSelected((s) => ({
      ...s,
      categories: [...(s.categories || []), { name: newCatName.trim(), items: [] }],
    }));
    setNewCatName('');
    setShowNewCatModal(false);
  }

  function deleteCategory(catIdx) {
    if (!confirm('카테고리와 항목을 모두 삭제하시겠습니까?')) return;
    setSelected((s) => {
      const cats = [...s.categories];
      cats.splice(catIdx, 1);
      return { ...s, categories: cats };
    });
  }

  function openItemModal(catIdx, itemIdx = null) {
    if (itemIdx !== null) {
      setItemForm({ ...selected.categories[catIdx].items[itemIdx] });
    } else {
      setItemForm({ ...EMPTY_ITEM, order: (selected.categories[catIdx].items?.length || 0) + 1 });
    }
    setShowItemModal({ catIdx, itemIdx });
  }

  function saveItem() {
    if (!itemForm.name.trim()) { addToast('항목명을 입력하세요.', 'error'); return; }
    const { catIdx, itemIdx } = showItemModal;
    setSelected((s) => {
      const cats = JSON.parse(JSON.stringify(s.categories));
      if (itemIdx !== null) {
        cats[catIdx].items[itemIdx] = { ...itemForm };
      } else {
        const catName = cats[catIdx].name;
        cats[catIdx].items.push({
          ...itemForm,
          id: `ITEM_${catName}_${itemForm.name}_${Date.now()}`,
        });
      }
      return { ...s, categories: cats };
    });
    setShowItemModal(null);
  }

  function deleteItem(catIdx, itemIdx) {
    setSelected((s) => {
      const cats = JSON.parse(JSON.stringify(s.categories));
      cats[catIdx].items.splice(itemIdx, 1);
      return { ...s, categories: cats };
    });
  }

  function toggleCollapse(key) {
    setCollapsed((p) => ({ ...p, [key]: !p[key] }));
  }

  return (
    <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'flex-start' }}>
      {/* Template list panel */}
      <div style={{ flex: '0 0 270px', minWidth: 230 }}>
        <div className="card">
          <div className="card-header">
            <span className="card-title">템플릿 목록</span>
          </div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
            <button className="btn btn-secondary btn-sm" onClick={handleCreateBlank}>
              <Plus size={13} /> 새로 만들기
            </button>
            <label className="btn btn-primary btn-sm" style={{ cursor: 'pointer' }}>
              <Upload size={13} /> 엑셀/CSV 업로드
              <input type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }} onChange={handleFileUpload} />
            </label>
          </div>

          <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 12, lineHeight: 1.4, background: '#f8fafc', padding: 8, borderRadius: 6 }}>
            💡 엑셀 또는 CSV에 행을 삽입하여 항목을 추가한 후 업로드하면, 기존 설비 체크리스트에도 자동 반영됩니다.
          </div>

          {templates.length === 0 ? (
            <div className="empty-state" style={{ padding: '20px 0' }}>
              <ClipboardList size={32} />
              <p style={{ fontSize: 13, marginTop: 8 }}>템플릿이 없습니다</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {templates.map((t) => (
                <div
                  key={t.id}
                  onClick={() => handleSelectTemplate(t)}
                  style={{
                    padding: '10px 12px',
                    borderRadius: 6, cursor: 'pointer',
                    background: selected?.id === t.id ? '#eff6ff' : 'var(--color-bg)',
                    border: selected?.id === t.id ? '1px solid var(--color-primary)' : '1px solid var(--color-border)',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  }}
                >
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>{t.name}</div>
                    <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{t.version} · {formatDateTime(t.createdAt)}</div>
                  </div>
                  <button
                    className="btn-icon"
                    onClick={(e) => { e.stopPropagation(); handleDelete(t); }}
                    style={{ color: 'var(--color-ng)' }}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Template editor panel */}
      {selected ? (
        <div style={{ flex: 1, minWidth: 320 }}>
          <div className="card">
            <div className="card-header">
              <div>
                <div style={{ fontWeight: 700, fontSize: 15 }}>{selected.name}</div>
                <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{selected.version}</div>
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <button className="btn btn-secondary btn-sm" onClick={() => setShowNewCatModal(true)}>
                  <Plus size={13} /> 카테고리 추가
                </button>
                <button className="btn btn-secondary btn-sm" onClick={handleExportTemplate}>
                  <Download size={13} /> 엑셀 내보내기
                </button>
                <button className="btn btn-primary btn-sm" onClick={handleSaveTemplate}>
                  저장 & 설비 반영
                </button>
              </div>
            </div>

            {/* Template name edit */}
            <div className="form-group" style={{ marginBottom: 16 }}>
              <label className="form-label">템플릿명</label>
              <input className="form-input" value={selected.name}
                onChange={(e) => setSelected((s) => ({ ...s, name: e.target.value }))} />
            </div>

            {/* Categories */}
            {(selected.categories || []).length === 0 ? (
              <div className="empty-state" style={{ padding: '20px 0' }}>
                <p>카테고리를 추가하세요.</p>
              </div>
            ) : (
              (selected.categories || []).map((cat, catIdx) => (
                <div key={catIdx} className="category-section">
                  <div className="category-header" onClick={() => toggleCollapse(catIdx)}>
                    {!collapsed[catIdx] ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    <span className="category-title">{cat.name}</span>
                    <span className="category-badge">{cat.items?.length || 0}개 항목</span>
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={(e) => { e.stopPropagation(); openItemModal(catIdx); }}
                      style={{ marginLeft: 8 }}
                    >
                      <Plus size={12} /> 행 삽입/추가
                    </button>
                    <button
                      className="btn-icon"
                      onClick={(e) => { e.stopPropagation(); deleteCategory(catIdx); }}
                      style={{ color: 'var(--color-ng)', marginLeft: 4 }}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>

                  {!collapsed[catIdx] && (
                    <div>
                      {(cat.items || []).length === 0 ? (
                        <div style={{ padding: '8px 12px', fontSize: 13, color: 'var(--color-text-muted)' }}>항목이 없습니다.</div>
                      ) : (
                        (cat.items || []).map((item, itemIdx) => (
                          <div key={itemIdx} style={{
                            display: 'flex', gap: 8, alignItems: 'center',
                            padding: '8px 12px', borderBottom: '1px solid var(--color-border)',
                          }}>
                            <span style={{ fontSize: 12, color: 'var(--color-text-muted)', minWidth: 20 }}>
                              {item.order || itemIdx + 1}
                            </span>
                            <div style={{ flex: 1 }}>
                              <div style={{ fontSize: 14, fontWeight: 500 }}>
                                {item.name}
                                {item.required === false && <span className="badge badge-na" style={{ fontSize: 11, marginLeft: 6 }}>선택</span>}
                              </div>
                              {item.criteria && <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{item.criteria}</div>}
                            </div>
                            {item.id && !item.id.startsWith('ITEM_') && !item.id.startsWith('LEGACY_') && (
                              <span className="badge badge-na" style={{ fontSize: 11 }}>
                                {item.id}
                              </span>
                            )}
                            <button className="btn-icon" onClick={() => openItemModal(catIdx, itemIdx)}>
                              <Pencil size={13} />
                            </button>
                            <button className="btn-icon" onClick={() => deleteItem(catIdx, itemIdx)} style={{ color: 'var(--color-ng)' }}>
                              <Trash2 size={13} />
                            </button>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      ) : (
        <div style={{ flex: 1 }} className="empty-state">
          <ClipboardList size={48} />
          <p>템플릿을 선택하거나 새로 만드세요.</p>
        </div>
      )}

      {/* New Category Modal */}
      {showNewCatModal && (
        <div className="modal-overlay" onClick={() => setShowNewCatModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">카테고리 추가</span>
              <button className="modal-close" onClick={() => setShowNewCatModal(false)}>✕</button>
            </div>
            <div className="form-group">
              <label className="form-label">카테고리명</label>
              <input
                className="form-input"
                value={newCatName}
                onChange={(e) => setNewCatName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addCategory()}
                placeholder="예: PC 세팅, 키엔스 2D 바코드"
                autoFocus
              />
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowNewCatModal(false)}>취소</button>
              <button className="btn btn-primary" onClick={addCategory}>추가</button>
            </div>
          </div>
        </div>
      )}

      {/* Item Modal */}
      {showItemModal !== null && (
        <div className="modal-overlay" onClick={() => setShowItemModal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">{showItemModal.itemIdx !== null ? '항목 수정' : '새 점검 항목 (행 삽입)'}</span>
              <button className="modal-close" onClick={() => setShowItemModal(null)}>✕</button>
            </div>
            <div className="form-group">
              <label className="form-label">항목명 (체크 항목) *</label>
              <input className="form-input" value={itemForm.name}
                onChange={(e) => setItemForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="예: 터치 / 키보드 / 마우스 이슈" />
            </div>
            <div className="form-group">
              <label className="form-label">확인 기준 / 비고</label>
              <input className="form-input" value={itemForm.criteria || ''}
                onChange={(e) => setItemForm((f) => ({ ...f, criteria: e.target.value }))}
                placeholder="예: 정상 동작 및 인식 확인" />
            </div>
            <div className="grid-2">
              <div className="form-group">
                <label className="form-label">순서</label>
                <input className="form-input" type="number" value={itemForm.order || 0}
                  onChange={(e) => setItemForm((f) => ({ ...f, order: parseInt(e.target.value, 10) || 0 }))} />
              </div>
              <div className="form-group">
                <label className="form-label">입력 형식</label>
                <select className="form-select" value={itemForm.inputType}
                  onChange={(e) => setItemForm((f) => ({ ...f, inputType: e.target.value }))}>
                  <option value="status">정상/이상 (상태 버튼)</option>
                  <option value="number">숫자 측정값 + 상태</option>
                  <option value="text">텍스트 입력 + 상태</option>
                </select>
              </div>
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, marginBottom: 12, cursor: 'pointer' }}>
              <input type="checkbox" checked={itemForm.required !== false}
                onChange={(e) => setItemForm((f) => ({ ...f, required: e.target.checked }))} />
              필수 항목 (해제 시 체크리스트 생성 때 기본으로 빠짐)
            </label>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowItemModal(null)}>취소</button>
              <button className="btn btn-primary" onClick={saveItem}>저장</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

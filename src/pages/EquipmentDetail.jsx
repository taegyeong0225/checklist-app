// 설비 상세 페이지 - 체크리스트 생성 및 점검 이력 (카테고리 단위 동기화 지원)
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { equipmentDB, checklistDB, resultDB, templateDB } from '../utils/db';
import { calcProgress, defaultCategoryItemIds, defaultInclusion, formatDateTime, isRequiredItem } from '../utils/helpers';
import { useToast } from '../components/ToastProvider';
import ChecklistPage from './ChecklistPage';
import { ArrowLeft, ClipboardList, Plus, ExternalLink, Pencil, CheckSquare, Square, Copy, ChevronDown, ChevronUp, Folder, Trash2 } from 'lucide-react';

export default function EquipmentDetail() {
  const { id } = useParams();
  const eqId = id;
  const navigate = useNavigate();
  const addToast = useToast();

  const [equipment, setEquipment] = useState(null);
  const [checklists, setChecklists] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [checklistStats, setChecklistStats] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [selTemplate, setSelTemplate] = useState('');
  const [allEquipments, setAllEquipments] = useState([]);
  const [copySource, setCopySource] = useState(null);
  const [copyTargetId, setCopyTargetId] = useState('');

  // 설비 수정 모달 상태
  const [showEditModal, setShowEditModal] = useState(false);
  const [editForm, setEditForm] = useState(null);
  const [expandedCats, setExpandedCats] = useState({});

  useEffect(() => { load(); }, [eqId]);

  async function load() {
    const [eq, cls, tpls, equipments] = await Promise.all([
      equipmentDB.getById(eqId),
      checklistDB.getByEquipmentId(eqId),
      templateDB.getAll(),
      equipmentDB.getAll(),
    ]);
    setEquipment(eq);
    setChecklists(cls);
    setTemplates(tpls);
    setAllEquipments(equipments);

    if (tpls && tpls.length > 0 && !selTemplate) {
      setSelTemplate(String(tpls[0].id));
    }

    const stats = await Promise.all(
      cls.map(async (cl) => {
        const results = await resultDB.getByChecklistId(cl.id);
        return { cl, ...calcProgress(cl, results) };
      })
    );
    setChecklistStats(stats);
  }

  function openEditEquipment() {
    const defTpl = templates.find((t) => t.id === equipment.templateId) || templates[0];
    let incCats = equipment.includedCategories;
    let incIds = equipment.includedItemIds;

    if (!incCats || incCats.length === 0) {
      incCats = defaultInclusion(defTpl).includedCategories;
    }
    if (!Array.isArray(incIds)) {
      incIds = defaultInclusion(defTpl).includedItemIds;
    }

    setEditForm({
      ...equipment,
      templateId: defTpl ? String(defTpl.id) : '',
      includedCategories: incCats,
      includedItemIds: incIds,
    });
    setExpandedCats({});
    setShowEditModal(true);
  }

  async function handleSaveEquipment() {
    if (!editForm.name.trim()) { addToast('설비명을 입력하세요.', 'error'); return; }
    try {
      await equipmentDB.put({ ...editForm });
      addToast('설비 정보와 포함 모듈을 수정했습니다.', 'success');
      setShowEditModal(false);
      load();
    } catch {
      addToast('저장 중 오류가 발생했습니다.', 'error');
    }
  }

  async function handleCreateChecklist() {
    if (checklists.length > 0) {
      navigate(`/equipments/${eqId}/checklist/${checklists[checklists.length - 1].id}`);
      return;
    }
    if (!selTemplate) { addToast('템플릿을 선택하세요.', 'error'); return; }
    const tpl = templates.find((t) => t.id === selTemplate);
    if (!tpl) return;

    // 설비에 지정된 포함 카테고리 필터링
    const incCats = equipment.includedCategories && equipment.includedCategories.length > 0
      ? new Set(equipment.includedCategories)
      : null;
    const incItemIds = incCats && Array.isArray(equipment.includedItemIds)
      ? new Set(equipment.includedItemIds)
      : null;

    const categories = (tpl.categories || [])
      .filter((cat) => !incCats || incCats.has(cat.name))
      .map((cat) => ({
        ...cat,
        items: (cat.items || [])
          .filter((item) => (incItemIds ? incItemIds.has(item.id) : isRequiredItem(item)))
          .map((item) => ({ ...item })),
      }))
      .filter((cat) => cat.items.length > 0);

    if (categories.length === 0) {
      addToast('포함된 모듈이 없습니다. 설비 설정에서 모듈을 선택하세요.', 'error');
      return;
    }

    const newCl = {
      equipmentId: eqId,
      templateId: tpl.id,
      templateVersion: tpl.version,
      templateName: tpl.name,
      categories,
      knownTemplateItemIds: (tpl.categories || []).flatMap((c) => (c.items || []).map((i) => String(i.id))),
      createdAt: new Date().toISOString(),
    };

    const clId = await checklistDB.add(newCl);
    addToast('체크리스트를 생성했습니다.', 'success');
    setShowModal(false);
    navigate(`/equipments/${eqId}/checklist/${clId}`);
  }

  if (!equipment) return <div style={{ padding: 24 }}>불러오는 중...</div>;

  function openCopyChecklist(checklist) {
    setCopySource(checklist);
    setCopyTargetId('');
  }

  async function handleCopyChecklist() {
    if (!copyTargetId || !copySource) {
      addToast('복사할 대상 설비를 선택하세요.', 'error');
      return;
    }
    const newChecklist = {
      equipmentId: copyTargetId,
      templateId: copySource.templateId,
      templateVersion: copySource.templateVersion,
      templateName: copySource.templateName,
      categories: JSON.parse(JSON.stringify(copySource.categories || [])),
      copiedFromChecklistId: copySource.id,
      createdAt: new Date().toISOString(),
    };
    await checklistDB.add(newChecklist);
    const target = allEquipments.find((item) => item.id === copyTargetId);
    addToast(`${target?.name || '대상 설비'}에 미점검 체크리스트를 복사했습니다.`, 'success');
    setCopySource(null);
  }

  async function handleDeleteChecklist(checklist) {
    if (!confirm(`${formatDateTime(checklist.createdAt)} 체크리스트를 삭제하시겠습니까?\n점검 결과도 함께 삭제되며 되돌릴 수 없습니다.`)) return;
    try {
      await checklistDB.delete(checklist.id);
      addToast('체크리스트를 삭제했습니다.', 'success');
      load();
    } catch (error) {
      console.error(error);
      addToast(`삭제 실패: ${error.message}`, 'error');
    }
  }

  const activeTemplate = templates.find((t) => t.id === editForm?.templateId) || templates[0];
  const activeChecklist = checklists[checklists.length - 1];
  const activeChecklistStats = checklistStats.find(({ cl }) => cl.id === activeChecklist?.id);

  function toggleAllEditCategories(selectAll) {
    if (!activeTemplate) return;
    if (selectAll) {
      const allCats = activeTemplate.categories.map((c) => c.name);
      const allIds = activeTemplate.categories.flatMap((c) => c.items.map((i) => i.id));
      setEditForm((f) => ({ ...f, includedCategories: allCats, includedItemIds: allIds }));
    } else {
      setEditForm((f) => ({ ...f, includedCategories: [], includedItemIds: [] }));
    }
  }

  function toggleEditCategory(cat) {
    const catName = cat.name;
    const catItemIds = cat.items.map((i) => i.id);
    const isCatIncluded = (editForm.includedCategories || []).includes(catName);

    setEditForm((f) => {
      const curCats = new Set(f.includedCategories || []);
      const curIds = new Set(f.includedItemIds || []);

      if (isCatIncluded) {
        curCats.delete(catName);
        catItemIds.forEach((id) => curIds.delete(id));
      } else {
        curCats.add(catName);
        defaultCategoryItemIds(cat).forEach((id) => curIds.add(id));
      }

      return {
        ...f,
        includedCategories: Array.from(curCats),
        includedItemIds: Array.from(curIds),
      };
    });
  }

  function toggleEditItem(cat, item) {
    setEditForm((f) => {
      const curCats = new Set(f.includedCategories || []);
      const curIds = new Set(f.includedItemIds || []);
      if (curIds.has(item.id)) curIds.delete(item.id);
      else {
        curCats.add(cat.name);
        curIds.add(item.id);
      }
      return { ...f, includedCategories: Array.from(curCats), includedItemIds: Array.from(curIds) };
    });
  }

  return (
    <div>
      {/* Back */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button className="btn btn-secondary btn-sm" onClick={() => navigate('/equipments')}>
          <ArrowLeft size={15} /> 목록으로
        </button>
        {equipment.folderId && (
          <button className="btn btn-secondary btn-sm" onClick={() => navigate(`/equipments?folder=${equipment.folderId}`)}>
            <Folder size={15} /> 폴더로 이동
          </button>
        )}
      </div>

      {/* Equipment Info */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span className="card-title" style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
              <span title={equipment.turnOnDate ? `TURN ON ${equipment.turnOnDate}` : 'TURN ON 미설정'} style={{ width: 11, height: 11, borderRadius: '50%', flexShrink: 0, background: equipment.turnOnDate ? 'var(--color-ok)' : 'var(--color-ng)' }} />
              ⚙️ {equipment.name}
            </span>
            <button className="btn btn-secondary btn-sm" onClick={openEditEquipment} title="설비 정보 및 포함 모듈 변경">
              <Pencil size={13} /> 모듈/정보 변경
            </button>
          </div>
          {activeChecklist ? (
            <div style={{ display: 'flex', gap: 6 }}>
              <button className="btn btn-primary btn-sm" style={{ display: 'none' }} onClick={() => navigate(`/equipments/${eqId}/checklist/${activeChecklist.id}`)}>
                <ExternalLink size={15} /> 체크리스트 열기
              </button>
              <button className="btn btn-secondary btn-sm" onClick={() => openCopyChecklist(activeChecklist)} title="다른 설비로 복사">
                <Copy size={14} /> 복사
              </button>
              <button className="btn btn-secondary btn-sm" onClick={() => handleDeleteChecklist(activeChecklist)} title="체크리스트 삭제" style={{ color: 'var(--color-ng)' }}>
                <Trash2 size={14} />
              </button>
            </div>
          ) : (
            <button className="btn btn-primary btn-sm" onClick={() => setShowModal(true)}>
              <Plus size={15} /> 체크리스트 생성
            </button>
          )}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px 32px', fontSize: 14 }}>
          {equipment.model && <div><span style={{ color: 'var(--color-text-muted)' }}>모델: </span>{equipment.model}</div>}
          {equipment.unit && <div><span style={{ color: 'var(--color-text-muted)' }}>호기: </span>{equipment.unit}호기</div>}
          {equipment.line && <div><span style={{ color: 'var(--color-text-muted)' }}>라인: </span>{equipment.line}</div>}
          {equipment.location && <div><span style={{ color: 'var(--color-text-muted)' }}>위치: </span>{equipment.location}</div>}
          <div><span style={{ color: 'var(--color-text-muted)' }}>TURN ON: </span>{equipment.turnOnDate || '미설정'}</div>
          <div>
            <span style={{ color: 'var(--color-text-muted)' }}>포함 모듈: </span>
            <strong style={{ color: 'var(--color-primary)' }}>
              {equipment.includedCategories ? `${equipment.includedCategories.length}개 모듈` : '전체'}
            </strong>
          </div>
        </div>

        {/* 모듈 배지 목록 */}
        {equipment.includedCategories && equipment.includedCategories.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 12 }}>
            {equipment.includedCategories.map((c) => (
              <span key={c} className="badge badge-na" style={{ fontSize: 12, padding: '3px 8px' }}>
                {c}
              </span>
            ))}
          </div>
        )}

        {equipment.memo && (
          <div style={{ marginTop: 10, fontSize: 13, color: 'var(--color-text-muted)' }}>{equipment.memo}</div>
        )}
        {activeChecklistStats && (
          <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--color-border)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
              <span style={{ fontWeight: 700, fontSize: 14 }}>점검 진행률</span>
              <span style={{ fontWeight: 700, color: 'var(--color-primary)' }}>{activeChecklistStats.pct}%</span>
            </div>
            <div className="progress-bar" style={{ marginTop: 8, height: 9 }}>
              <div className="progress-bar-fill" style={{ width: `${activeChecklistStats.pct}%` }} />
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 9, flexWrap: 'wrap' }}>
              <span className="badge badge-ng">이상 {activeChecklistStats.ng}</span>
              <span className="badge badge-pending">미점검 {activeChecklistStats.pending}</span>
              <span className="badge badge-ok">완료 {activeChecklistStats.done}/{activeChecklistStats.total}</span>
            </div>
          </div>
        )}
      </div>

      {false && (
      <>
      {/* Checklists */}
      <div className="card">
        <div className="card-header">
          <span className="card-title"><ClipboardList size={16} style={{ display: 'inline', verticalAlign: -2 }} /> 점검 이력</span>
        </div>

        {checklistStats.length === 0 ? (
          <div className="empty-state">
            <ClipboardList size={48} />
            <p>생성된 체크리스트가 없습니다.</p>
            <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginTop: 4 }}>
              설비에 설정된 모듈을 바탕으로 체크리스트를 생성하세요.
            </p>
            <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={() => setShowModal(true)}>
              체크리스트 생성
            </button>
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>생성일</th>
                  <th>템플릿</th>
                  <th>버전</th>
                  <th>진행률</th>
                  <th>이상</th>
                  <th>미점검</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {checklistStats.slice().reverse().map(({ cl, pct, ng, pending }) => (
                  <tr key={cl.id}>
                    <td style={{ fontSize: 13 }}>{formatDateTime(cl.createdAt)}</td>
                    <td>{cl.templateName || '-'}</td>
                    <td><span className="badge badge-na">{cl.templateVersion || '-'}</span></td>
                    <td style={{ minWidth: 130 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div className="progress-bar" style={{ flex: 1 }}>
                          <div className="progress-bar-fill" style={{ width: `${pct}%` }} />
                        </div>
                        <span style={{ fontSize: 13, minWidth: 36 }}>{pct}%</span>
                      </div>
                    </td>
                    <td>{ng > 0 ? <span className="badge badge-ng">{ng}</span> : '-'}</td>
                    <td>{pending > 0 ? <span className="badge badge-pending">{pending}</span> : (pct === 100 ? <span className="badge badge-ok">완료</span> : '-')}</td>
                    <td>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button
                          className="btn btn-primary btn-sm"
                          onClick={() => navigate(`/equipments/${eqId}/checklist/${cl.id}`)}
                        >
                          <ExternalLink size={13} /> 점검
                        </button>
                        <button className="btn btn-secondary btn-sm" onClick={() => openCopyChecklist(cl)}>
                          <Copy size={13} /> 복사
                        </button>
                        <button className="btn btn-secondary btn-sm" onClick={() => handleDeleteChecklist(cl)} style={{ color: 'var(--color-ng)' }} title="체크리스트 삭제">
                          <Trash2 size={13} /> 삭제
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      </>
      )}

      {activeChecklist && (
        <div style={{ marginTop: 20 }}>
          <ChecklistPage embedded equipmentId={eqId} checklistId={activeChecklist.id} />
        </div>
      )}

      {copySource && (
        <div className="modal-overlay" onClick={() => setCopySource(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">체크리스트 복사</span>
              <button className="modal-close" onClick={() => setCopySource(null)}>×</button>
            </div>
            <p style={{ fontSize: 13, color: 'var(--color-text-muted)', lineHeight: 1.5 }}>
              항목과 확인 기준만 복사합니다. 정상/이상, 측정값, 비고, 확인자 결과는 복사하지 않아 모두 미점검으로 시작합니다.
            </p>
            <div className="form-group" style={{ marginTop: 16 }}>
              <label className="form-label">대상 설비 *</label>
              <select className="form-select" value={copyTargetId} onChange={(e) => setCopyTargetId(e.target.value)}>
                <option value="">설비 선택</option>
                {allEquipments.filter((item) => item.id !== eqId).map((item) => (
                  <option key={item.id} value={item.id}>{item.name}{item.line ? ` · ${item.line}` : ''}</option>
                ))}
              </select>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setCopySource(null)}>취소</button>
              <button className="btn btn-primary" onClick={handleCopyChecklist} disabled={!copyTargetId}>미점검으로 복사</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: 체크리스트 생성 */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">체크리스트 생성</span>
              <button className="modal-close" onClick={() => setShowModal(false)}>✕</button>
            </div>

            <div className="form-group">
              <label className="form-label">마스터 템플릿 선택 *</label>
              {templates.length === 0 ? (
                <div style={{ fontSize: 14, color: 'var(--color-text-muted)', padding: '12px 0' }}>
                  등록된 템플릿이 없습니다.
                </div>
              ) : (
                <select className="form-select" value={selTemplate} onChange={(e) => setSelTemplate(e.target.value)}>
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>{t.name} ({t.version})</option>
                  ))}
                </select>
              )}
            </div>

            <div style={{ background: '#f8fafc', padding: 12, borderRadius: 8, fontSize: 13, marginBottom: 16 }}>
              📌 <strong>{equipment.name}</strong> 설비에 지정된{' '}
              <span style={{ color: 'var(--color-primary)', fontWeight: 600 }}>
                {equipment.includedCategories ? `${equipment.includedCategories.length}개 모듈` : '전체 모듈'}
              </span>
              로 체크리스트가 자동 구성됩니다.
            </div>

            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowModal(false)}>취소</button>
              <button className="btn btn-primary" onClick={handleCreateChecklist} disabled={!selTemplate}>체크리스트 생성</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: 설비 정보 및 포함 모듈 변경 */}
      {showEditModal && editForm && (
        <div className="modal-overlay" onClick={() => setShowEditModal(false)}>
          <div className="modal" style={{ maxWidth: 660, maxHeight: '92vh' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">설비 수정 및 포함 모듈 설정</span>
              <button className="modal-close" onClick={() => setShowEditModal(false)}>✕</button>
            </div>

            <div className="form-group">
              <label className="form-label">설비명 *</label>
              <input className="form-input" value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} />
            </div>
            <div className="form-group">
              <label className="form-label">호기</label>
              <input className="form-input" value={editForm.unit || ''} onChange={(e) => setEditForm({ ...editForm, unit: e.target.value })} />
            </div>
            <div className="form-group">
              <label className="form-label">위치</label>
              <input className="form-input" value={editForm.location || ''} onChange={(e) => setEditForm({ ...editForm, location: e.target.value })} />
            </div>

            <div className="form-group">
              <label className="form-label">TURN ON 일자</label>
              <input className="form-input" type="date" value={editForm.turnOnDate || ''} onChange={(e) => setEditForm({ ...editForm, turnOnDate: e.target.value })} />
            </div>

            {/* 포함 모듈 선택 */}
            <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--color-border)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
                <div>
                  <label className="form-label" style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>
                    🔧 포함되는 장비 / 모듈 선택
                  </label>
                  <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 2 }}>
                    선택된 모듈({editForm.includedCategories?.length || 0}개)에 엑셀 행이 새로 삽입되어도 설비 체크리스트에 자동 반영됩니다.
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => toggleAllEditCategories(true)}>
                    전체 선택
                  </button>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => toggleAllEditCategories(false)}>
                    전체 해제
                  </button>
                </div>
              </div>

              {activeTemplate && (
                <div style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                  maxHeight: 380,
                  overflowY: 'auto',
                  paddingRight: 6,
                  WebkitOverflowScrolling: 'touch',
                }}>
                  {activeTemplate.categories.map((cat) => {
                    const isCatIncluded = (editForm.includedCategories || []).includes(cat.name);

                    return (
                      <div
                        key={cat.name}
                        style={{
                          flexShrink: 0,
                          border: '1px solid var(--color-border)',
                          borderRadius: 8,
                          background: isCatIncluded ? '#f0fdf4' : '#fafafa',
                          overflow: 'hidden',
                        }}
                      >
                        <div
                          style={{
                            padding: '12px 14px',
                            minHeight: 48,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            cursor: 'pointer',
                          }}
                          onClick={() => toggleEditCategory(cat)}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <button
                              type="button"
                              style={{ display: 'flex', alignItems: 'center', padding: 2 }}
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleEditCategory(cat);
                              }}
                            >
                              {isCatIncluded ? (
                                <CheckSquare size={20} color="var(--color-ok)" />
                              ) : (
                                <Square size={20} color="var(--color-text-muted)" />
                              )}
                            </button>
                            <span style={{ fontSize: 14, fontWeight: isCatIncluded ? 700 : 500, color: isCatIncluded ? '#111827' : '#64748b', lineHeight: 1.4 }}>
                              {cat.name}
                            </span>
                            <span className="badge badge-na" style={{ fontSize: 11 }}>
                              {cat.items.length}개 항목
                            </span>
                            <button
                              type="button"
                              className="btn-icon"
                              onClick={(e) => {
                                e.stopPropagation();
                                setExpandedCats((state) => ({ ...state, [cat.name]: !state[cat.name] }));
                              }}
                              title="하위 항목 선택"
                            >
                              {expandedCats[cat.name] ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                            </button>
                          </div>
                        </div>
                        {isCatIncluded && expandedCats[cat.name] && (
                          <div style={{ padding: '0 14px 12px', borderTop: '1px solid var(--color-border)' }}>
                            {cat.items.map((item) => {
                              const isItemIncluded = (editForm.includedItemIds || []).includes(item.id);
                              return (
                                <button
                                  key={item.id}
                                  type="button"
                                  onClick={() => toggleEditItem(cat, item)}
                                  style={{ display: 'flex', width: '100%', gap: 8, alignItems: 'flex-start', padding: '9px 0', textAlign: 'left', borderBottom: '1px solid #f1f5f9' }}
                                >
                                  {isItemIncluded ? <CheckSquare size={17} color="var(--color-ok)" /> : <Square size={17} color="var(--color-text-muted)" />}
                                  <span style={{ fontSize: 13, color: isItemIncluded ? 'var(--color-text)' : 'var(--color-text-muted)' }}>{item.name}{item.required === false && <span className="badge badge-na" style={{ fontSize: 11, marginLeft: 6 }}>선택</span>}</span>
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="form-group" style={{ marginTop: 16 }}>
              <label className="form-label">메모</label>
              <textarea className="form-input" rows={2} value={editForm.memo || ''} onChange={(e) => setEditForm({ ...editForm, memo: e.target.value })} />
            </div>

            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowEditModal(false)}>취소</button>
              <button className="btn btn-primary" onClick={handleSaveEquipment}>저장</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

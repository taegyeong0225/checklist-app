// 설비 상세 페이지 - 체크리스트 생성 및 점검 이력 (카테고리 단위 동기화 지원)
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { equipmentDB, checklistDB, resultDB, templateDB } from '../utils/db';
import { calcProgress, formatDateTime } from '../utils/helpers';
import { useToast } from '../components/ToastProvider';
import { ArrowLeft, ClipboardList, Plus, ExternalLink, Pencil, CheckSquare, Square, ChevronDown, ChevronUp } from 'lucide-react';

export default function EquipmentDetail() {
  const { id } = useParams();
  const eqId = Number(id);
  const navigate = useNavigate();
  const addToast = useToast();

  const [equipment, setEquipment] = useState(null);
  const [checklists, setChecklists] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [checklistStats, setChecklistStats] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [selTemplate, setSelTemplate] = useState('');

  // 설비 수정 모달 상태
  const [showEditModal, setShowEditModal] = useState(false);
  const [editForm, setEditForm] = useState(null);
  const [expandedCats, setExpandedCats] = useState({});

  useEffect(() => { load(); }, [eqId]);

  async function load() {
    const [eq, cls, tpls] = await Promise.all([
      equipmentDB.getById(eqId),
      checklistDB.getByEquipmentId(eqId),
      templateDB.getAll(),
    ]);
    setEquipment(eq);
    setChecklists(cls);
    setTemplates(tpls);

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
    const defTpl = templates.find((t) => t.id === Number(equipment.templateId)) || templates[0];
    let incCats = equipment.includedCategories;
    let incIds = equipment.includedItemIds;

    if (!incCats || incCats.length === 0) {
      incCats = defTpl ? defTpl.categories.map((c) => c.name) : [];
    }
    if (!incIds || incIds.length === 0) {
      incIds = defTpl ? defTpl.categories.flatMap((c) => c.items.map((i) => i.id)) : [];
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
    if (!selTemplate) { addToast('템플릿을 선택하세요.', 'error'); return; }
    const tpl = templates.find((t) => t.id === Number(selTemplate));
    if (!tpl) return;

    // 설비에 지정된 포함 카테고리 필터링
    const incCats = equipment.includedCategories && equipment.includedCategories.length > 0
      ? new Set(equipment.includedCategories)
      : null;

    const categories = (tpl.categories || [])
      .filter((cat) => !incCats || incCats.has(cat.name))
      .map((cat) => ({
        ...cat,
        items: (cat.items || []).map((item) => ({ ...item })),
      }));

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
      createdAt: new Date().toISOString(),
    };

    const clId = await checklistDB.add(newCl);
    addToast('체크리스트를 생성했습니다.', 'success');
    setShowModal(false);
    navigate(`/equipments/${eqId}/checklist/${clId}`);
  }

  if (!equipment) return <div style={{ padding: 24 }}>불러오는 중...</div>;

  const activeTemplate = templates.find((t) => t.id === Number(editForm?.templateId)) || templates[0];

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
        catItemIds.forEach((id) => curIds.add(id));
      }

      return {
        ...f,
        includedCategories: Array.from(curCats),
        includedItemIds: Array.from(curIds),
      };
    });
  }

  return (
    <div>
      {/* Back */}
      <button className="btn btn-secondary btn-sm" style={{ marginBottom: 16 }} onClick={() => navigate('/equipments')}>
        <ArrowLeft size={15} /> 목록으로
      </button>

      {/* Equipment Info */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span className="card-title">⚙️ {equipment.name}</span>
            <button className="btn btn-secondary btn-sm" onClick={openEditEquipment} title="설비 정보 및 포함 모듈 변경">
              <Pencil size={13} /> 모듈/정보 변경
            </button>
          </div>
          <button className="btn btn-primary btn-sm" onClick={() => setShowModal(true)}>
            <Plus size={15} /> 체크리스트 생성
          </button>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px 32px', fontSize: 14 }}>
          {equipment.model && <div><span style={{ color: 'var(--color-text-muted)' }}>모델: </span>{equipment.model}</div>}
          {equipment.unit && <div><span style={{ color: 'var(--color-text-muted)' }}>호기: </span>{equipment.unit}호기</div>}
          {equipment.line && <div><span style={{ color: 'var(--color-text-muted)' }}>라인: </span>{equipment.line}</div>}
          {equipment.location && <div><span style={{ color: 'var(--color-text-muted)' }}>위치: </span>{equipment.location}</div>}
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
      </div>

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
                      <button
                        className="btn btn-primary btn-sm"
                        onClick={() => navigate(`/equipments/${eqId}/checklist/${cl.id}`)}
                      >
                        <ExternalLink size={13} /> 점검
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

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
            <div className="grid-2">
              <div className="form-group">
                <label className="form-label">모델</label>
                <input className="form-input" value={editForm.model || ''} onChange={(e) => setEditForm({ ...editForm, model: e.target.value })} />
              </div>
              <div className="form-group">
                <label className="form-label">호기</label>
                <input className="form-input" value={editForm.unit || ''} onChange={(e) => setEditForm({ ...editForm, unit: e.target.value })} />
              </div>
            </div>
            <div className="grid-2">
              <div className="form-group">
                <label className="form-label">라인</label>
                <input className="form-input" value={editForm.line || ''} onChange={(e) => setEditForm({ ...editForm, line: e.target.value })} />
              </div>
              <div className="form-group">
                <label className="form-label">위치</label>
                <input className="form-input" value={editForm.location || ''} onChange={(e) => setEditForm({ ...editForm, location: e.target.value })} />
              </div>
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
                          </div>
                        </div>
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

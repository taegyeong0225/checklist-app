// 설비 목록 페이지 - 폴더(메인 설비 그룹) & 단위 설비 계층 구조 지원
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { folderDB, equipmentDB, checklistDB, resultDB, templateDB } from '../utils/db';
import { calcProgress } from '../utils/helpers';
import { useToast } from '../components/ToastProvider';
import {
  Folder, FolderPlus, Plus, Pencil, Trash2, ChevronRight,
  Server, ArrowLeft, CheckSquare, Square, ChevronDown, ChevronUp, Layers, Sparkles, Copy
} from 'lucide-react';

const EMPTY_FOLDER = { name: '', model: '', unit: '', line: '', location: '', memo: '' };
const EMPTY_EQUIPMENT = {
  name: '',
  model: '',
  unit: '',
  line: '',
  location: '',
  folderId: null,
  templateId: '',
  includedCategories: [],
  includedItemIds: [],
  memo: '',
};

// 현장에서 자주 쓰이는 단위 설비 기본 추천 목록 (빠른 등록용)
const DEFAULT_PRESET_UNITS = [
  'LOADER FRONT',
  'LOADER REAR',
  'SHUTTLE',
  'INLINE BUFFER',
  'LOADER CONV',
  'UNLOADER FRONT',
  'UNLOADER REAR',
  'UNLOADER CONV',
  'UNLOADER BUFFER',
];

export default function EquipmentList() {
  const [folders, setFolders] = useState([]);
  const [equipments, setEquipments] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [folderProgressMap, setFolderProgressMap] = useState({}); // folderId -> { pct, total, done, ng }
  const [eqProgressMap, setEqProgressMap] = useState({});         // eqId -> { pct, ng, pending }

  const [currentFolderId, setCurrentFolderId] = useState(null); // null = 루트, number = 특정 폴더 안
  const [filter, setFilter] = useState('');
  const [lineFilter, setLineFilter] = useState('');

  // 폴더 모달 상태
  const [showFolderModal, setShowFolderModal] = useState(false);
  const [editFolderItem, setEditFolderItem] = useState(null);
  const [copySourceFolder, setCopySourceFolder] = useState(null);
  const [folderForm, setFolderForm] = useState(EMPTY_FOLDER);

  // 설비 모달 상태
  const [showEqModal, setShowEqModal] = useState(false);
  const [editEqItem, setEditEqItem] = useState(null);
  const [eqForm, setEqForm] = useState(EMPTY_EQUIPMENT);
  const [expandedCats, setExpandedCats] = useState({});

  // 일괄 등록 모달 상태
  const [showBatchModal, setShowBatchModal] = useState(false);
  const [batchNamesText, setBatchNamesText] = useState('');

  const navigate = useNavigate();
  const addToast = useToast();

  useEffect(() => { load(); }, []);

  async function load() {
    const [fds, eqs, tpls, allCls, allRs] = await Promise.all([
      folderDB.getAll(),
      equipmentDB.getAll(),
      templateDB.getAll(),
      checklistDB.getAll(),
      resultDB.getAll(),
    ]);

    setFolders(fds);
    setEquipments(eqs);
    setTemplates(tpls);

    // 각 설비별 진행률 계산
    const eqProg = {};
    for (const eq of eqs) {
      const cls = allCls.filter((c) => c.equipmentId === eq.id);
      if (cls.length > 0) {
        const latestCl = cls[cls.length - 1];
        const rs = allRs.filter((r) => r.checklistId === latestCl.id);
        eqProg[eq.id] = calcProgress(latestCl, rs);
      } else {
        eqProg[eq.id] = { pct: 0, done: 0, total: 0, ng: 0, pending: 0 };
      }
    }
    setEqProgressMap(eqProg);

    // 각 폴더별 종합 진행률 계산
    const fdProg = {};
    for (const fd of fds) {
      const subEqs = eqs.filter((e) => e.folderId === fd.id);
      let subTotalItems = 0;
      let subDoneItems = 0;
      let subNgItems = 0;

      for (const sub of subEqs) {
        const p = eqProg[sub.id];
        if (p) {
          subTotalItems += p.total;
          subDoneItems += p.done;
          subNgItems += p.ng;
        }
      }

      const pct = subTotalItems === 0 ? 0 : Math.round((subDoneItems / subTotalItems) * 100);
      fdProg[fd.id] = { pct, total: subTotalItems, done: subDoneItems, ng: subNgItems, count: subEqs.length };
    }
    setFolderProgressMap(fdProg);
  }

  // 현재 열려있는 폴더 객체
  const currentFolder = folders.find((f) => f.id === currentFolderId);

  // ───── 폴더(메인 설비 그룹) 모달 처리 ─────
  function openAddFolder() {
    setEditFolderItem(null);
    setCopySourceFolder(null);
    setFolderForm(EMPTY_FOLDER);
    setShowFolderModal(true);
  }

  function openEditFolder(fd) {
    setEditFolderItem(fd);
    setCopySourceFolder(null);
    setFolderForm({ ...fd });
    setShowFolderModal(true);
  }

  function openCopyFolder(fd) {
    setEditFolderItem(null);
    setCopySourceFolder(fd);
    setFolderForm({ ...fd, name: `${fd.name} 복사본` });
    setShowFolderModal(true);
  }

  async function copyFolderContents(sourceFolderId, targetFolderId) {
    const sourceChecklists = await checklistDB.getAll();
    const sourceEquipments = equipments.filter((equipment) => equipment.folderId === sourceFolderId);

    for (const sourceEquipment of sourceEquipments) {
      const { id, createdAt, folderId, ...equipmentData } = sourceEquipment;
      const targetEquipmentId = await equipmentDB.add({ ...equipmentData, folderId: targetFolderId });
      const equipmentChecklists = sourceChecklists.filter((checklist) => checklist.equipmentId === id);

      for (const sourceChecklist of equipmentChecklists) {
        const { id: checklistId, createdAt: checklistCreatedAt, equipmentId, ...checklistData } = sourceChecklist;
        await checklistDB.add({ ...checklistData, equipmentId: targetEquipmentId });
      }
    }
  }

  async function handleSaveFolder() {
    if (!folderForm.name.trim()) { addToast('폴더(메인 설비명)를 입력하세요.', 'error'); return; }
    try {
      if (editFolderItem) {
        await folderDB.put({ ...editFolderItem, ...folderForm });
        addToast('폴더 정보를 수정했습니다.', 'success');
      } else {
        const folderId = await folderDB.add({ ...folderForm });
        if (copySourceFolder) await copyFolderContents(copySourceFolder.id, folderId);
        addToast(copySourceFolder ? '폴더와 하위 설비를 복사했습니다. 점검 결과는 포함하지 않았습니다.' : '메인 설비 폴더를 생성했습니다.', 'success');
      }
      await load();
      setShowFolderModal(false);
      setCopySourceFolder(null);
    } catch (error) {
      console.error(error);
      addToast(`저장 실패: ${error.message}`, 'error');
    }
  }

  async function handleDeleteFolder(fd) {
    if (!confirm(`"${fd.name}" 폴더를 삭제하시겠습니까?\n소속된 하위 설비는 단독 설비로 보존됩니다.`)) return;
    await folderDB.delete(fd.id);
    addToast('폴더를 삭제했습니다.');
    if (currentFolderId === fd.id) setCurrentFolderId(null);
    load();
  }

  // ───── 단위 설비 모달 처리 ─────
  const activeTemplate = templates.find((t) => t.id === eqForm.templateId) || templates[0];

  function openAddEquipment(presetFolderId = currentFolderId) {
    setEditEqItem(null);
    const defTpl = templates[0];
    const allCatNames = defTpl ? defTpl.categories.map((c) => c.name) : [];
    const allItemIds = defTpl ? defTpl.categories.flatMap((c) => c.items.map((i) => i.id)) : [];

    // 폴더 안에서 만들 경우 폴더 기본정보(모델, 호기, 라인 등)를 상속
    const parentFolder = folders.find((f) => f.id === presetFolderId);

    setEqForm({
      ...EMPTY_EQUIPMENT,
      folderId: presetFolderId,
      model: parentFolder?.model || '',
      unit: parentFolder?.unit || '',
      line: parentFolder?.line || '',
      location: parentFolder?.location || '',
      templateId: defTpl ? String(defTpl.id) : '',
      includedCategories: allCatNames,
      includedItemIds: allItemIds,
    });
    setExpandedCats({});
    setShowEqModal(true);
  }

  function openEditEquipment(eq) {
    setEditEqItem(eq);
    const defTpl = templates.find((t) => t.id === eq.templateId) || templates[0];
    let incCats = eq.includedCategories;
    let incIds = eq.includedItemIds;

    if (!incCats || incCats.length === 0) {
      incCats = defTpl ? defTpl.categories.map((c) => c.name) : [];
    }
    if (!incIds || incIds.length === 0) {
      incIds = defTpl ? defTpl.categories.flatMap((c) => c.items.map((i) => i.id)) : [];
    }

    setEqForm({
      ...EMPTY_EQUIPMENT,
      ...eq,
      templateId: defTpl ? String(defTpl.id) : '',
      includedCategories: incCats,
      includedItemIds: incIds,
    });
    setExpandedCats({});
    setShowEqModal(true);
  }

  async function handleSaveEquipment() {
    if (!eqForm.name.trim()) { addToast('설비명을 입력하세요.', 'error'); return; }
    try {
      if (editEqItem) {
        await equipmentDB.put({ ...editEqItem, ...eqForm });
        addToast('설비 정보를 수정했습니다.', 'success');
      } else {
        await equipmentDB.add({ ...eqForm });
        addToast('설비를 추가했습니다.', 'success');
      }
      await load();
      setShowEqModal(false);
    } catch (error) {
      console.error(error);
      addToast(`저장 실패: ${error.message || '권한을 확인하세요.'}`, 'error');
    }
  }

  async function handleDeleteEquipment(eq) {
    if (!confirm(`"${eq.name}" 설비를 삭제하시겠습니까?\n체크리스트와 점검 기록도 함께 삭제됩니다.`)) return;
    await equipmentDB.delete(eq.id);
    addToast('설비를 삭제했습니다.');
    load();
  }

  // ───── 빠른 일괄 하위 설비 추가 ─────
  function openBatchAdd() {
    setBatchNamesText(DEFAULT_PRESET_UNITS.join('\n'));
    setShowBatchModal(true);
  }

  async function handleSaveBatch() {
    const lines = batchNamesText
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);

    if (lines.length === 0) {
      addToast('설비명을 1개 이상 입력하세요.', 'error');
      return;
    }

    const defTpl = templates[0];
    const allCatNames = defTpl ? defTpl.categories.map((c) => c.name) : [];
    const allItemIds = defTpl ? defTpl.categories.flatMap((c) => c.items.map((i) => i.id)) : [];

    for (const name of lines) {
      await equipmentDB.add({
        name,
        folderId: currentFolderId,
        model: currentFolder?.model || '',
        unit: currentFolder?.unit || '',
        line: currentFolder?.line || '',
        location: currentFolder?.location || '',
        templateId: defTpl ? String(defTpl.id) : '',
        includedCategories: allCatNames,
        includedItemIds: allItemIds,
      });
    }

    addToast(`하위 단위 설비 ${lines.length}대를 일괄 생성했습니다!`, 'success');
    setShowBatchModal(false);
    load();
  }

  // 필터링 목록 계산
  const lines = [
    ...new Set([
      ...folders.map((f) => f.line),
      ...equipments.map((e) => e.line),
    ].filter(Boolean)),
  ];

  const filteredFolders = folders.filter((f) => {
    const q = filter.toLowerCase();
    const matchQ = !q || f.name?.toLowerCase().includes(q) || f.model?.toLowerCase().includes(q) || f.line?.toLowerCase().includes(q);
    const matchL = !lineFilter || f.line === lineFilter;
    return matchQ && matchL;
  });

  // 현재 폴더 안의 설비들 또는 루트의 단독 설비들
  const visibleEquipments = equipments.filter((e) => {
    if (currentFolderId !== null) {
      return e.folderId === currentFolderId;
    }
    // 루트에서는 폴더에 속하지 않은 단독 설비만 보여줌
    return !e.folderId;
  }).filter((e) => {
    const q = filter.toLowerCase();
    const matchQ = !q || e.name?.toLowerCase().includes(q) || e.model?.toLowerCase().includes(q) || e.line?.toLowerCase().includes(q);
    const matchL = !lineFilter || e.line === lineFilter;
    return matchQ && matchL;
  });

  function toggleAllCategories(selectAll) {
    if (!activeTemplate) return;
    if (selectAll) {
      const allCats = activeTemplate.categories.map((c) => c.name);
      const allIds = activeTemplate.categories.flatMap((c) => c.items.map((i) => i.id));
      setEqForm((f) => ({ ...f, includedCategories: allCats, includedItemIds: allIds }));
    } else {
      setEqForm((f) => ({ ...f, includedCategories: [], includedItemIds: [] }));
    }
  }

  function toggleCategory(cat) {
    const catName = cat.name;
    const catItemIds = cat.items.map((i) => i.id);
    const isCatIncluded = (eqForm.includedCategories || []).includes(catName);

    setEqForm((f) => {
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
      {/* ───── 최상위 브레드크럼 & 헤더 ───── */}
      {currentFolder ? (
        <div style={{ marginBottom: 20 }}>
          <button
            className="btn btn-secondary btn-sm"
            style={{ marginBottom: 12 }}
            onClick={() => setCurrentFolderId(null)}
          >
            <ArrowLeft size={15} /> 전체 설비 목록으로 나가기
          </button>

          {/* 폴더 배너 */}
          <div className="card" style={{ background: '#f8fafc', border: '1px solid #cbd5e1' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ background: '#e0e7ff', padding: 12, borderRadius: 10, color: '#3730a3' }}>
                  <Folder size={32} />
                </div>
                <div>
                  <div style={{ fontSize: 18, fontWeight: 700 }}>{currentFolder.name}</div>
                  <div style={{ fontSize: 13, color: 'var(--color-text-muted)', marginTop: 2 }}>
                    {[currentFolder.model, currentFolder.unit && `${currentFolder.unit}호기`, currentFolder.line, currentFolder.location].filter(Boolean).join(' · ')}
                    {currentFolder.memo && ` | ${currentFolder.memo}`}
                  </div>
                </div>
              </div>

              {/* 액션 버튼들 */}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button className="btn btn-secondary btn-sm" onClick={openBatchAdd} title="LOADER, BUFFER 등 기본 단위설비 일괄 등록">
                  <Sparkles size={14} /> 하위 설비 빠른 일괄 추가
                </button>
                <button className="btn btn-primary btn-sm" onClick={() => openAddEquipment(currentFolder.id)}>
                  <Plus size={15} /> 단위 설비 추가
                </button>
              </div>
            </div>

            {/* 폴더 전체 종합 진행률 바 */}
            {folderProgressMap[currentFolder.id] && (
              <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid #e2e8f0' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 6 }}>
                  <span>
                    하위 설비 종합 점검률 (<strong>{folderProgressMap[currentFolder.id].count}대 설비</strong>)
                  </span>
                  <span style={{ fontWeight: 700, color: 'var(--color-primary)' }}>
                    {folderProgressMap[currentFolder.id].pct}% 완료
                    {folderProgressMap[currentFolder.id].ng > 0 && (
                      <span style={{ color: 'var(--color-ng)', marginLeft: 8 }}>(이상 {folderProgressMap[currentFolder.id].ng}건)</span>
                    )}
                  </span>
                </div>
                <div className="progress-bar" style={{ height: 10 }}>
                  <div className="progress-bar-fill" style={{ width: `${folderProgressMap[currentFolder.id].pct}%` }} />
                </div>
              </div>
            )}
          </div>
        </div>
      ) : (
        /* 최상위 루트 툴바 */
        <div className="filter-bar">
          <input
            className="form-input"
            placeholder="설비 / 폴더명 검색..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <select className="form-select" value={lineFilter} onChange={(e) => setLineFilter(e.target.value)}>
            <option value="">전체 라인</option>
            {lines.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
          <button className="btn btn-primary" onClick={openAddFolder}>
            <FolderPlus size={16} /> 폴더(메인 설비) 생성
          </button>
          <button className="btn btn-secondary" onClick={() => openAddEquipment(null)}>
            <Plus size={16} /> 단독 설비 추가
          </button>
        </div>
      )}

      {/* ───── 최상위: 폴더(메인 설비 그룹) 목록 섹션 ───── */}
      {currentFolderId === null && (
        <div style={{ marginBottom: 28 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12, fontSize: 15, fontWeight: 700 }}>
            <Folder size={18} color="#f59e0b" />
            <span>메인 설비 그룹 (폴더)</span>
            <span className="badge badge-na" style={{ fontSize: 11, marginLeft: 4 }}>
              {filteredFolders.length}개
            </span>
          </div>

          {filteredFolders.length === 0 ? (
            <div style={{ padding: '24px 16px', background: '#fff', border: '1px dashed var(--color-border)', borderRadius: 8, textAlign: 'center', color: 'var(--color-text-muted)' }}>
              생성된 메인 설비 폴더가 없습니다. <strong>[+ 폴더(메인 설비) 생성]</strong> 버튼을 눌러 그룹을 만드세요.
              <br /><span style={{ fontSize: 12 }}>예: SFA GEN2 FCM 3호기, A라인 검사기 등</span>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(290px, 1fr))', gap: 16 }}>
              {filteredFolders.map((fd) => {
                const prog = folderProgressMap[fd.id] || { pct: 0, count: 0, ng: 0 };
                return (
                  <div
                    key={fd.id}
                    className="equipment-card"
                    style={{ borderLeft: '4px solid #f59e0b', background: '#fff' }}
                    onClick={() => setCurrentFolderId(fd.id)}
                  >
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 4 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Folder size={22} color="#f59e0b" fill="#fef3c7" />
                        <span style={{ fontSize: 16, fontWeight: 700 }}>{fd.name}</span>
                      </div>
                      <span className="badge badge-na" style={{ fontSize: 11 }}>
                        하위 {prog.count}대
                      </span>
                    </div>

                    <div className="equipment-card-meta">
                      {[fd.model, fd.unit && `${fd.unit}호기`, fd.line, fd.location].filter(Boolean).join(' · ')}
                    </div>

                    {/* 폴더 종합 진행률 */}
                    <div style={{ marginTop: 10 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 4 }}>
                        <span>종합 완료율</span>
                        <span>
                          {prog.pct}%
                          {prog.ng > 0 && <span style={{ color: 'var(--color-ng)', marginLeft: 4 }}>이상 {prog.ng}</span>}
                        </span>
                      </div>
                      <div className="progress-bar" style={{ height: 6 }}>
                        <div className="progress-bar-fill" style={{ width: `${prog.pct}%` }} />
                      </div>
                    </div>

                    <div style={{ display: 'flex', gap: 6, justifyContent: 'space-between', alignItems: 'center', marginTop: 12, paddingTop: 8, borderTop: '1px solid #f1f5f9' }}>
                      <span style={{ fontSize: 12, color: 'var(--color-primary)', fontWeight: 600 }}>
                        열기 →
                      </span>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button
                          className="btn-icon"
                          onClick={(e) => { e.stopPropagation(); openEditFolder(fd); }}
                          title="폴더 정보 수정"
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          className="btn-icon"
                          onClick={(e) => { e.stopPropagation(); openCopyFolder(fd); }}
                          title="폴더와 하위 설비 복사"
                        >
                          <Copy size={14} />
                        </button>
                        <button
                          className="btn-icon"
                          onClick={(e) => { e.stopPropagation(); handleDeleteFolder(fd); }}
                          title="폴더 삭제"
                          style={{ color: 'var(--color-ng)' }}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ───── 하위 단위 설비 목록 ───── */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 15, fontWeight: 700 }}>
            <Server size={18} color="var(--color-primary)" />
            <span>{currentFolder ? `소속 단위 설비 목록 (${currentFolder.name})` : '단독 설비 목록 (미분류)'}</span>
            <span className="badge badge-na" style={{ fontSize: 11, marginLeft: 4 }}>
              {visibleEquipments.length}대
            </span>
          </div>

          {currentFolder && (
            <button className="btn btn-primary btn-sm" onClick={() => openAddEquipment(currentFolder.id)}>
              <Plus size={14} /> 단위 설비 추가
            </button>
          )}
        </div>

        {visibleEquipments.length === 0 ? (
          <div className="empty-state" style={{ padding: '36px 16px', background: '#fff', borderRadius: 8, border: '1px dashed var(--color-border)' }}>
            <Server size={40} />
            <p style={{ marginTop: 8 }}>{currentFolder ? '이 폴더에 등록된 단위 설비가 없습니다.' : '등록된 단독 설비가 없습니다.'}</p>
            {currentFolder && (
              <div style={{ marginTop: 12, display: 'flex', gap: 8, justifyContent: 'center' }}>
                <button className="btn btn-secondary btn-sm" onClick={openBatchAdd}>
                  <Sparkles size={13} /> LOADER, BUFFER 등 일괄 자동 생성
                </button>
                <button className="btn btn-primary btn-sm" onClick={() => openAddEquipment(currentFolder.id)}>
                  <Plus size={13} /> 직접 1대 추가
                </button>
              </div>
            )}
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
            {visibleEquipments.map((eq) => {
              const prog = eqProgressMap[eq.id] || { pct: 0, ng: 0, pending: 0 };
              const catCount = eq.includedCategories ? eq.includedCategories.length : null;

              return (
                <div
                  key={eq.id}
                  className="equipment-card"
                  onClick={() => navigate(`/equipments/${eq.id}`)}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
                    <div className="equipment-card-name" style={{ fontSize: 15 }}>{eq.name}</div>
                    <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-primary)' }}>
                      {prog.pct}%
                    </span>
                  </div>

                  <div className="equipment-card-meta">
                    {[eq.model, eq.unit && `${eq.unit}호기`, eq.line, eq.location].filter(Boolean).join(' · ')}
                  </div>

                  {/* 진행률 바 */}
                  <div className="progress-bar" style={{ height: 6, margin: '8px 0' }}>
                    <div className="progress-bar-fill" style={{ width: `${prog.pct}%` }} />
                  </div>

                  {/* 포함된 모듈 배지 */}
                  {eq.includedCategories && eq.includedCategories.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, margin: '8px 0' }}>
                      {eq.includedCategories.slice(0, 3).map((c) => (
                        <span key={c} style={{ fontSize: 11, background: '#f1f5f9', padding: '2px 6px', borderRadius: 4, color: '#475569' }}>
                          {c}
                        </span>
                      ))}
                      {eq.includedCategories.length > 3 && (
                        <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>+{eq.includedCategories.length - 3}</span>
                      )}
                    </div>
                  )}

                  <div style={{ display: 'flex', gap: 6, justifyContent: 'space-between', alignItems: 'center', marginTop: 10, paddingTop: 8, borderTop: '1px solid #f8fafc' }}>
                    <div style={{ display: 'flex', gap: 6 }}>
                      {prog.ng > 0 ? (
                        <span className="badge badge-ng" style={{ fontSize: 11 }}>이상 {prog.ng}</span>
                      ) : prog.pct === 100 ? (
                        <span className="badge badge-ok" style={{ fontSize: 11 }}>완료</span>
                      ) : null}
                    </div>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button
                        className="btn-icon"
                        onClick={(e) => { e.stopPropagation(); openEditEquipment(eq); }}
                        title="설비 및 포함 모듈 수정"
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        className="btn-icon"
                        onClick={(e) => { e.stopPropagation(); handleDeleteEquipment(eq); }}
                        title="설비 삭제"
                        style={{ color: 'var(--color-ng)' }}
                      >
                        <Trash2 size={14} />
                      </button>
                      <ChevronRight size={15} style={{ color: 'var(--color-text-muted)' }} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ───── Modal 1: 메인 설비 폴더 생성 / 수정 ───── */}
      {showFolderModal && (
        <div className="modal-overlay" onClick={() => setShowFolderModal(false)}>
          <div className="modal" style={{ maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">
                {editFolderItem ? '메인 설비 폴더 수정' : '메인 설비 폴더 생성'}
              </span>
              <button className="modal-close" onClick={() => setShowFolderModal(false)}>✕</button>
            </div>

            <div className="form-group">
              <label className="form-label">메인 설비 그룹명 (폴더명) *</label>
              <input
                className="form-input"
                value={folderForm.name}
                onChange={(e) => setFolderForm({ ...folderForm, name: e.target.value })}
                placeholder="예: SFA GEN2 FCM 3호기, 검사기 라인 등"
                autoFocus
              />
            </div>

            <div className="grid-2">
              <div className="form-group">
                <label className="form-label">모델</label>
                <input
                  className="form-input"
                  value={folderForm.model}
                  onChange={(e) => setFolderForm({ ...folderForm, model: e.target.value })}
                  placeholder="예: GEN2"
                />
              </div>
              <div className="form-group">
                <label className="form-label">호기</label>
                <input
                  className="form-input"
                  value={folderForm.unit}
                  onChange={(e) => setFolderForm({ ...folderForm, unit: e.target.value })}
                  placeholder="예: 3"
                />
              </div>
            </div>

            <div className="grid-2">
              <div className="form-group">
                <label className="form-label">라인</label>
                <input
                  className="form-input"
                  value={folderForm.line}
                  onChange={(e) => setFolderForm({ ...folderForm, line: e.target.value })}
                  placeholder="예: A라인"
                />
              </div>
              <div className="form-group">
                <label className="form-label">위치</label>
                <input
                  className="form-input"
                  value={folderForm.location}
                  onChange={(e) => setFolderForm({ ...folderForm, location: e.target.value })}
                  placeholder="예: 1공장 2층"
                />
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">메모</label>
              <textarea
                className="form-input"
                rows={2}
                value={folderForm.memo}
                onChange={(e) => setFolderForm({ ...folderForm, memo: e.target.value })}
                placeholder="메인 설비 메모"
              />
            </div>

            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowFolderModal(false)}>취소</button>
              <button className="btn btn-primary" onClick={handleSaveFolder}>저장</button>
            </div>
          </div>
        </div>
      )}

      {/* ───── Modal 2: 단위 설비 추가 / 수정 ───── */}
      {showEqModal && (
        <div className="modal-overlay" onClick={() => setShowEqModal(false)}>
          <div className="modal" style={{ maxWidth: 660, maxHeight: '92vh' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">
                {editEqItem ? '단위 설비 수정' : currentFolder ? `[${currentFolder.name}] 하위 설비 추가` : '단독 설비 추가'}
              </span>
              <button className="modal-close" onClick={() => setShowEqModal(false)}>✕</button>
            </div>

            {/* 소속 폴더 선택 */}
            <div className="form-group">
              <label className="form-label">소속 메인 설비 폴더</label>
              <select
                className="form-select"
                value={eqForm.folderId || ''}
                onChange={(e) => setEqForm({ ...eqForm, folderId: e.target.value || null })}
              >
                <option value="">- 단독 설비 (폴더 없음) -</option>
                {folders.map((f) => (
                  <option key={f.id} value={f.id}>📁 {f.name} ({f.unit ? `${f.unit}호기` : f.line || ''})</option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">단위 설비명 *</label>
              <input
                className="form-input"
                value={eqForm.name}
                onChange={(e) => setEqForm({ ...eqForm, name: e.target.value })}
                placeholder="예: LOADER FRONT, INLINE BUFFER, UNLOADER 등"
                autoFocus
              />
            </div>

            <div className="grid-2">
              <div className="form-group">
                <label className="form-label">모델</label>
                <input className="form-input" value={eqForm.model} onChange={(e) => setEqForm({ ...eqForm, model: e.target.value })} placeholder="예: GEN2" />
              </div>
              <div className="form-group">
                <label className="form-label">호기</label>
                <input className="form-input" value={eqForm.unit} onChange={(e) => setEqForm({ ...eqForm, unit: e.target.value })} placeholder="예: 3" />
              </div>
            </div>

            <div className="grid-2">
              <div className="form-group">
                <label className="form-label">라인</label>
                <input className="form-input" value={eqForm.line} onChange={(e) => setEqForm({ ...eqForm, line: e.target.value })} placeholder="예: A라인" />
              </div>
              <div className="form-group">
                <label className="form-label">위치</label>
                <input className="form-input" value={eqForm.location} onChange={(e) => setEqForm({ ...eqForm, location: e.target.value })} placeholder="예: 1공장 2층" />
              </div>
            </div>

            {/* 포함 모듈/카테고리 선택 */}
            <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--color-border)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
                <div>
                  <label className="form-label" style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>
                    🔧 이 단위 설비에 포함되는 모듈 선택
                  </label>
                  <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 2 }}>
                    선택된 모듈({eqForm.includedCategories?.length || 0}개)의 점검 항목이 체크리스트에 구성됩니다.
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => toggleAllCategories(true)}>
                    전체 선택
                  </button>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => toggleAllCategories(false)}>
                    전체 해제
                  </button>
                </div>
              </div>

              {activeTemplate ? (
                <div style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                  maxHeight: 340,
                  overflowY: 'auto',
                  paddingRight: 6,
                  WebkitOverflowScrolling: 'touch',
                }}>
                  {activeTemplate.categories.map((cat) => {
                    const isCatIncluded = (eqForm.includedCategories || []).includes(cat.name);

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
                          onClick={() => toggleCategory(cat)}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <button
                              type="button"
                              style={{ display: 'flex', alignItems: 'center', padding: 2 }}
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleCategory(cat);
                              }}
                            >
                              {isCatIncluded ? (
                                <CheckSquare size={20} color="var(--color-ok)" />
                              ) : (
                                <Square size={20} color="var(--color-text-muted)" />
                              )}
                            </button>
                            <span style={{ fontSize: 14, fontWeight: isCatIncluded ? 700 : 500, color: isCatIncluded ? '#111827' : '#64748b' }}>
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
              ) : null}
            </div>

            <div className="form-group" style={{ marginTop: 16 }}>
              <label className="form-label">메모</label>
              <textarea className="form-input" rows={2} value={eqForm.memo} onChange={(e) => setEqForm({ ...eqForm, memo: e.target.value })} placeholder="설비 특이사항 또는 메모" />
            </div>

            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowEqModal(false)}>취소</button>
              <button className="btn btn-primary" onClick={handleSaveEquipment}>저장</button>
            </div>
          </div>
        </div>
      )}

      {/* ───── Modal 3: 하위 단위 설비 빠른 일괄 추가 ───── */}
      {showBatchModal && (
        <div className="modal-overlay" onClick={() => setShowBatchModal(false)}>
          <div className="modal" style={{ maxWidth: 540 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">
                ✨ [{currentFolder?.name}] 하위 단위 설비 일괄 추가
              </span>
              <button className="modal-close" onClick={() => setShowBatchModal(false)}>✕</button>
            </div>

            <div style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 12 }}>
              한 줄에 하나씩 설비명을 입력하세요. 아래 기본 셋을 그대로 사용하거나 수정할 수 있습니다:
            </div>

            <div className="form-group">
              <textarea
                className="form-input"
                rows={10}
                style={{ fontFamily: 'monospace', fontSize: 13, lineHeight: 1.6 }}
                value={batchNamesText}
                onChange={(e) => setBatchNamesText(e.target.value)}
              />
            </div>

            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowBatchModal(false)}>취소</button>
              <button className="btn btn-primary" onClick={handleSaveBatch}>일괄 생성</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

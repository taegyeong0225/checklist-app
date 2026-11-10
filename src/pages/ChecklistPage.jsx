// 점검 화면 - 핵심 페이지 (최신 템플릿 자동 동기화 지원)
import { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { equipmentDB, checklistDB, resultDB, photoDB, templateDB } from '../utils/db';
import { CHECKED_STATUSES, calcProgress, clearNewlyAddedFlags, formatDateTime, syncChecklistWithTemplate } from '../utils/helpers';
import { exportChecklistToExcel } from '../utils/excel';
import { useToast } from '../components/ToastProvider';
import {
  ArrowLeft, Download, ChevronDown, ChevronRight,
  Camera, Trash2, Filter, AlertTriangle, RefreshCw, Sparkles, CheckCircle
} from 'lucide-react';

const STATUS_OPTIONS = [
  { value: 'ok',      label: '정상',    cls: 'ok' },
  { value: 'ng',      label: '이상',    cls: 'ng' },
  { value: 'na',      label: '해당없음', cls: 'na' },
  { value: 'pending', label: '미점검',  cls: 'pending' },
];

export default function ChecklistPage({ embedded = false, equipmentId: embeddedEquipmentId, checklistId: embeddedChecklistId }) {
  const { equipmentId, checklistId } = useParams();
  const eqId = embeddedEquipmentId || equipmentId;
  const clId = embeddedChecklistId || checklistId;
  const navigate = useNavigate();
  const addToast = useToast();

  const [equipment, setEquipment] = useState(null);
  const [checklist, setChecklist] = useState(null);
  const [results, setResults] = useState([]);
  const [photos, setPhotos] = useState({});
  const [collapsed, setCollapsed] = useState({});
  const [filterMode, setFilterMode] = useState('all');
  // 필터를 고른 시점에 보이던 항목 ID. 점검 상태를 바꿔도 화면에서 바로 사라지지 않게 유지
  const [filterSnapshot, setFilterSnapshot] = useState(new Set());
  // 화면을 열 때 이미 완료돼 있던 카테고리. 점검 중에 완료돼도 바로 접히지 않게 진입 시점 기준으로만 접음
  const [completedOnLoad, setCompletedOnLoad] = useState(new Set());
  const [saving, setSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState(null);
  const saveTimer = useRef(null);
  const resultsRef = useRef(results);
  useEffect(() => { resultsRef.current = results; }, [results]);
  const pendingWrites = useRef({});

  // 화면을 벗어날 때 아직 저장되지 않은 비고/측정값 저장
  useEffect(() => () => {
    Object.keys(pendingWrites.current).forEach((key) => flushField(key));
  }, [clId]);

  useEffect(() => {
    loadAndSync();
  }, [clId]);

  async function loadAndSync() {
    const [eq, cl, rs, tpls] = await Promise.all([
      equipmentDB.getById(eqId),
      checklistDB.getById(clId),
      resultDB.getByChecklistId(clId),
      templateDB.getAll(),
    ]);

    if (!cl) {
      addToast('체크리스트를 찾을 수 없습니다.', 'error');
      return;
    }

    setEquipment(eq);
    setResults(rs);

    // 사진 로드
    const photoMap = {};
    for (const p of await photoDB.getByResultIds(rs.map((r) => r.id))) {
      (photoMap[p.resultId] ||= []).push(p);
    }
    setPhotos(photoMap);

    // 🌟 최신 마스터 템플릿과 자동 동기화 (행 삽입 등 신규 항목 반영)
    const masterTpl = tpls.find((t) => t.id === cl.templateId) || tpls[0];
    let nextCl = cl;
    let needsSave = false;
    if (masterTpl) {
      const resultIds = new Set(rs.map((r) => String(r.itemId)));
      const { updatedChecklist, addedCount, restoredCount, changed } = syncChecklistWithTemplate(cl, masterTpl, eq, resultIds);
      if (changed) {
        nextCl = updatedChecklist;
        needsSave = true;
        if (restoredCount > 0) addToast(`🛟 점검 기록이 남아있던 항목 ${restoredCount}개를 복구했습니다.`, 'success', 5000);
        if (addedCount > 0) addToast(`✨ 템플릿 변경사항과 신규 항목 ${addedCount}개를 반영했습니다!`, 'success', 4500);
      }
    }

    // 이미 점검 상태가 입력된 항목은 '신규 추가' 표시 해제
    const checkedIds = new Set(rs.filter((r) => CHECKED_STATUSES.includes(r.status)).map((r) => String(r.itemId)));
    const cleared = clearNewlyAddedFlags(nextCl, checkedIds);
    if (cleared !== nextCl) {
      nextCl = cleared;
      needsSave = true;
    }

    if (needsSave) await checklistDB.put(nextCl);
    setChecklist(nextCl);
    setCollapsed({});
    setFilterMode('all');
    setFilterSnapshot(new Set());
    const doneIds = new Set(rs.filter((r) => CHECKED_STATUSES.includes(r.status)).map((r) => String(r.itemId)));
    setCompletedOnLoad(new Set(
      (nextCl.categories || [])
        .filter((cat) => (cat.items || []).length > 0 && cat.items.every((item) => doneIds.has(String(item.id))))
        .map((cat) => cat.name),
    ));
  }

  function matchesFilter(mode, result) {
    if (mode === 'ng') return result.status === 'ng';
    if (mode === 'pending') return !result.status || result.status === 'pending';
    return true;
  }

  // 같은 필터를 다시 누르면 현재 상태 기준으로 목록을 새로 고침
  function changeFilter(mode) {
    setFilterMode(mode);
    const ids = new Set();
    for (const cat of checklist?.categories || []) {
      for (const item of cat.items || []) {
        if (matchesFilter(mode, getResult(item.id))) ids.add(String(item.id));
      }
    }
    setFilterSnapshot(ids);
  }

  // 점검 상태를 처음 누르면 해당 항목의 '신규 추가' 표시 해제
  async function clearNewFlagOnCheck(itemId, status) {
    if (!CHECKED_STATUSES.includes(status) || !checklist) return;
    const cleared = clearNewlyAddedFlags(checklist, new Set([String(itemId)]));
    if (cleared === checklist) return;
    setChecklist(cleared);
    try {
      await checklistDB.put(cleared);
    } catch (error) {
      console.error(error);
    }
  }

  // 수동 템플릿 재동기화 버튼
  async function handleManualSync() {
    const tpls = await templateDB.getAll();
    const masterTpl = tpls.find((t) => t.id === checklist.templateId) || tpls[0];
    if (!masterTpl) {
      addToast('동기화할 마스터 템플릿이 없습니다.', 'error');
      return;
    }
    const resultIds = new Set(results.map((r) => String(r.itemId)));
    const { updatedChecklist, addedCount, restoredCount, changed } = syncChecklistWithTemplate(checklist, masterTpl, equipment, resultIds);
    if (changed) {
      await checklistDB.put(updatedChecklist);
      setChecklist(updatedChecklist);
      if (restoredCount > 0) addToast(`🛟 점검 기록이 남아있던 항목 ${restoredCount}개를 복구했습니다.`, 'success', 5000);
      addToast(addedCount > 0 ? `✨ 템플릿 변경사항과 신규 항목 ${addedCount}개를 반영했습니다!` : '템플릿 변경사항을 반영했습니다.', 'success');
    } else {
      addToast('이미 마스터 템플릿과 최신 상태로 일치합니다.', 'default');
    }
  }

  const getResult = (itemId) => results.find((r) => String(r.itemId) === String(itemId)) || {};

  async function handleStatus(itemId, status) {
    clearNewFlagOnCheck(itemId, status);
    const updated = await resultDB.upsert(clId, itemId, {
      status,
      value: getResult(itemId).value || '',
      note: getResult(itemId).note || '',
    });
    setResults((prev) => {
      const idx = prev.findIndex((r) => String(r.itemId) === String(itemId));
      const record = { itemId, checklistId: clId, status, updatedAt: new Date().toISOString(), ...getResult(itemId) };
      if (typeof updated === 'number') record.id = updated;
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], status };
        return next;
      }
      return [...prev, record];
    });
    scheduleSave();
  }

  // 입력은 화면에 즉시 반영하고, 서버 저장은 입력이 멈춘 뒤 한 번만 수행
  // (키 입력마다 저장 완료를 기다리면 글자가 밀리고 한글 조합이 깨짐)
  function handleField(itemId, field, value) {
    const key = String(itemId);
    const entry = pendingWrites.current[key] || { itemId };
    clearTimeout(entry.timer);
    entry.timer = setTimeout(() => flushField(key), 600);
    pendingWrites.current[key] = entry;
    setSaving(true);
    setResults((prev) => {
      const idx = prev.findIndex((r) => String(r.itemId) === String(itemId));
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], [field]: value, updatedAt: new Date().toISOString() };
        return next;
      }
      return [...prev, { itemId, checklistId: clId, [field]: value, updatedAt: new Date().toISOString() }];
    });
  }

  async function flushField(key) {
    const entry = pendingWrites.current[key];
    if (!entry) return;
    clearTimeout(entry.timer);
    delete pendingWrites.current[key];
    const r = resultsRef.current.find((item) => String(item.itemId) === key) || {};
    try {
      const id = await resultDB.upsert(clId, entry.itemId, { status: r.status || 'pending', ...r });
      if (!r.id && id) {
        setResults((prev) => prev.map((item) => (String(item.itemId) === key && !item.id ? { ...item, id } : item)));
      }
      scheduleSave();
    } catch (error) {
      console.error(error);
      setSaving(false);
      addToast('비고 저장에 실패했습니다. 네트워크를 확인하세요.', 'error');
    }
  }

  function scheduleSave() {
    setSaving(true);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      setSaving(false);
      setLastSaved(new Date());
    }, 800);
  }

  async function handlePhoto(itemId, file) {
    if (!file) return;
    const r = getResult(itemId);
    let resultId = r.id;
    if (!resultId) {
      resultId = await resultDB.upsert(clId, itemId, { status: r.status || 'pending' });
      const rs = await resultDB.getByChecklistId(clId);
      setResults(rs);
    }
    const reader = new FileReader();
    reader.onload = async (e) => {
      const photoId = await photoDB.add({ resultId, dataUrl: e.target.result, name: file.name });
      setPhotos((prev) => ({
        ...prev,
        [resultId]: [...(prev[resultId] || []), { id: photoId, resultId, dataUrl: e.target.result, name: file.name }],
      }));
      addToast('사진을 추가했습니다.', 'success');
    };
    reader.readAsDataURL(file);
  }

  async function handleDeletePhoto(resultId, photoId) {
    await photoDB.delete(photoId);
    setPhotos((prev) => ({
      ...prev,
      [resultId]: (prev[resultId] || []).filter((p) => p.id !== photoId),
    }));
  }

  async function handleDeleteItem(item) {
    const result = getResult(item.id);
    if (result.id) await resultDB.delete(result.id);

    const updatedChecklist = {
      ...checklist,
      excludedItemIds: [...new Set([...(checklist.excludedItemIds || []), String(item.id)])],
      categories: (checklist.categories || [])
        .map((category) => ({ ...category, items: category.items.filter((entry) => String(entry.id) !== String(item.id)) }))
        .filter((category) => category.items.length > 0),
    };
    await checklistDB.put(updatedChecklist);
    setChecklist(updatedChecklist);
    setResults((previous) => previous.filter((entry) => String(entry.itemId) !== String(item.id)));
    addToast('이 체크리스트에서 항목을 삭제했습니다.', 'success');
  }

  // 직접 펼치거나 접은 카테고리는 그 상태를 유지 (자동 접힘보다 우선)
  function toggleCollapse(catName, isOpen) {
    setCollapsed((prev) => ({ ...prev, [catName]: isOpen }));
  }

  function handleExport() {
    try {
      exportChecklistToExcel(equipment, checklist, results);
      addToast('엑셀 파일을 내려받았습니다.', 'success');
    } catch (e) {
      console.error(e);
      addToast('엑셀 내보내기 실패', 'error');
    }
  }

  if (!equipment || !checklist) return <div style={{ padding: 24 }}>불러오는 중...</div>;

  const prog = calcProgress(checklist, results);

  return (
    <div>
      {/* Back + Actions */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
        <button className="btn btn-secondary btn-sm" style={{ display: embedded ? 'none' : undefined }} onClick={() => navigate(`/equipments/${eqId}`)}>
          <ArrowLeft size={15} /> 뒤로
        </button>
        <div style={{ flex: 1 }} />
        <button className="btn btn-secondary btn-sm" onClick={handleManualSync} title="마스터 템플릿의 신규 추가 항목 동기화">
          <RefreshCw size={14} /> 템플릿 변경 동기화
        </button>
        <button className="btn btn-secondary btn-sm" onClick={handleExport}>
          <Download size={15} /> 엑셀 내보내기
        </button>
      </div>

      {!embedded && (
      <>
      {/* Header card */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 4 }}>{equipment.name}</div>
            <div style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
              {[equipment.model, equipment.unit && `${equipment.unit}호기`, equipment.line, equipment.location].filter(Boolean).join(' · ')}
            </div>
            <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 4 }}>
              템플릿: {checklist.templateName} ({checklist.templateVersion})
              {checklist.lastSyncedAt && ` · 최신 동기화: ${formatDateTime(checklist.lastSyncedAt)}`}
            </div>
          </div>
          <div style={{ textAlign: 'right', minWidth: 100 }}>
            <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--color-primary)' }}>{prog.pct}%</div>
            <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{prog.done}/{prog.total} 완료</div>
          </div>
        </div>

        {/* Progress */}
        <div className="progress-bar" style={{ marginTop: 12, height: 10 }}>
          <div className="progress-bar-fill" style={{ width: `${prog.pct}%` }} />
        </div>

        {/* Summary badges */}
        <div style={{ display: 'flex', gap: 10, marginTop: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <span className="badge badge-ng"><AlertTriangle size={11} style={{ marginRight: 4 }} />이상 {prog.ng}</span>
          <span className="badge badge-pending">미점검 {prog.pending}</span>
          <span className="badge badge-ok">완료 {prog.done}</span>
          {saving ? (
            <span className="saving-badge">· 저장 중...</span>
          ) : lastSaved ? (
            <span className="autosave-badge">· 저장됨 {lastSaved.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}</span>
          ) : null}
        </div>

      </div>
      </>
      )}

      {/* Filter */}
      <div className="filter-bar" style={{ marginBottom: 16 }}>
        <span style={{ fontSize: 13, fontWeight: 500 }}><Filter size={14} style={{ verticalAlign: -2 }} /> 필터</span>
        {[
          { v: 'all', label: '전체' },
          { v: 'ng', label: '이상만' },
          { v: 'pending', label: '미점검만' },
        ].map(({ v, label }) => (
          <button
            key={v}
            className={`btn btn-sm ${filterMode === v ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => changeFilter(v)}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Categories */}
      {(checklist.categories || []).map((cat) => {
        const catResults = (cat.items || []).map((item) => ({ item, result: getResult(item.id) }));
        const filteredItems = filterMode === 'all'
          ? catResults
          : catResults.filter(({ item }) => filterSnapshot.has(String(item.id)));
        if (filteredItems.length === 0) return null;

        const catDone = catResults.filter(({ result }) => ['ok','ng','na'].includes(result.status)).length;
        const catNg = catResults.filter(({ result }) => result.status === 'ng').length;
        // 직접 접거나 펼친 적이 없으면, 전체 보기에서 화면 진입 시 이미 완료된 카테고리는 자동으로 접음
        const isComplete = catResults.length > 0 && catDone === catResults.length;
        const isOpen = collapsed[cat.name] === undefined
          ? !(filterMode === 'all' && completedOnLoad.has(cat.name))
          : !collapsed[cat.name];

        return (
          <div key={cat.name} className="category-section">
            <div className="category-header" onClick={() => toggleCollapse(cat.name, isOpen)}>
              {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
              <span className="category-title">{cat.name}</span>
              <span className="category-badge">
                {isComplete && <CheckCircle size={14} color="var(--color-ok)" style={{ marginRight: 4, verticalAlign: -2 }} />}
                {catDone}/{catResults.length}
                {catNg > 0 && <span className="badge badge-ng" style={{ marginLeft: 6 }}>이상 {catNg}</span>}
              </span>
            </div>

            {isOpen && (
              <div>
                {filteredItems.map(({ item, result }) => (
                  <CheckItem
                    key={item.id}
                    item={item}
                    result={result}
                    photos={result.id ? (photos[result.id] || []) : []}
                    onStatus={(s) => handleStatus(item.id, s)}
                    onField={(f, v) => handleField(item.id, f, v)}
                    onPhoto={(file) => handlePhoto(item.id, file)}
                    onDeletePhoto={(photoId) => handleDeletePhoto(result.id, photoId)}
                    onDelete={() => handleDeleteItem(item)}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function CheckItem({ item, result, photos, onStatus, onField, onPhoto, onDeletePhoto, onDelete }) {
  const [showNote, setShowNote] = useState(!!(result.note || result.value));
  const fileRef = useRef(null);

  const status = result.status || 'pending';

  return (
    <div
      className={`checklist-item-card ${status === 'ng' ? 'border-ng' : ''}`}
      style={{
        borderLeft: `4px solid ${status === 'ng' ? 'var(--color-ng)' : status === 'ok' ? 'var(--color-ok)' : 'var(--color-border)'}`,
        background: item.isNewlyAdded ? '#fffbeb' : 'var(--color-surface)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <div className="checklist-item-name" style={{ margin: 0 }}>
          {item.name}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {item.isNewlyAdded && (
            <span className="badge badge-pending" style={{ fontSize: 11 }}>
              <Sparkles size={11} style={{ marginRight: 3 }} />신규 추가 항목
            </span>
          )}
          <button className="btn-icon" onClick={onDelete} title="이 체크리스트에서 항목 삭제" style={{ color: 'var(--color-ng)' }}>
            <Trash2 size={15} />
          </button>
        </div>
      </div>

      {item.criteria && (
        <div className="checklist-item-criteria">{item.criteria}</div>
      )}

      {/* Status buttons */}
      <div className="status-btn-group" style={{ marginBottom: 8 }}>
        {STATUS_OPTIONS.map(({ value, label, cls }) => (
          <button
            key={value}
            className={`status-btn ${cls}${status === value ? ' selected' : ''}`}
            onClick={() => onStatus(value)}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Expand for note/value */}
      <button
        style={{ fontSize: 12, color: 'var(--color-text-muted)', background: 'none', cursor: 'pointer', marginBottom: showNote ? 8 : 0 }}
        onClick={() => setShowNote((v) => !v)}
      >
        {showNote ? '▲ 접기' : '▼ 비고/측정값 입력'}
      </button>

      {showNote && (
        <div className="checklist-item-controls">
          {item.inputType === 'number' && (
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <label style={{ fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap' }}>측정값</label>
              <input
                className="form-input"
                type="number"
                style={{ maxWidth: 160 }}
                value={result.value || ''}
                onChange={(e) => onField('value', e.target.value)}
                placeholder="숫자 입력"
              />
            </div>
          )}
          {item.inputType === 'text' && (
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <label style={{ fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap' }}>값</label>
              <input
                className="form-input"
                value={result.value || ''}
                onChange={(e) => onField('value', e.target.value)}
                placeholder="텍스트 입력"
              />
            </div>
          )}
          <div>
            <label style={{ fontSize: 13, fontWeight: 500, display: 'block', marginBottom: 4 }}>비고</label>
            <textarea
              className="form-input"
              rows={2}
              value={result.note || ''}
              onChange={(e) => onField('note', e.target.value)}
              placeholder="비고 입력"
            />
          </div>

          {/* Photos */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <label style={{ fontSize: 13, fontWeight: 500 }}>사진</label>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => fileRef.current?.click()}
              >
                <Camera size={13} /> 추가
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                capture="environment"
                style={{ display: 'none' }}
                onChange={(e) => { onPhoto(e.target.files[0]); e.target.value = ''; }}
              />
            </div>
            {photos.length > 0 && (
              <div className="photo-grid">
                {photos.map((p) => (
                  <div key={p.id} className="photo-item">
                    <img src={p.dataUrl} alt={p.name} />
                    <button className="photo-delete" onClick={() => onDeletePhoto(p.id)}>
                      <Trash2 size={11} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {result.updatedAt && (
            <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
              마지막 수정: {formatDateTime(result.updatedAt)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

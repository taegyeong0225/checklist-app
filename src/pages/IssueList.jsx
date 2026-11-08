import { useEffect, useMemo, useState } from 'react';
import { Plus, Pencil, Trash2, Wrench } from 'lucide-react';
import { equipmentDB, issueDB, isMissingTableError } from '../utils/db';
import { formatDateTime } from '../utils/helpers';
import { useToast } from '../components/ToastProvider';

const EMPTY_ISSUE = { equipmentName: '', issue: '', solution: '' };

export default function IssueList() {
  const addToast = useToast();
  const [issues, setIssues] = useState([]);
  const [equipmentNames, setEquipmentNames] = useState([]);
  const [loading, setLoading] = useState(true);
  const [missingTable, setMissingTable] = useState(false);
  const [query, setQuery] = useState('');
  const [form, setForm] = useState(null); // null이면 모달 닫힘
  const [saving, setSaving] = useState(false);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    try {
      const [list, equipments] = await Promise.all([issueDB.getAll(), equipmentDB.getAll()]);
      setIssues(list);
      setEquipmentNames([...new Set(equipments.map((e) => e.name).filter(Boolean))].sort());
      setMissingTable(false);
    } catch (error) {
      if (isMissingTableError(error)) setMissingTable(true);
      else addToast(`불러오기 실패: ${error.message}`, 'error');
    } finally {
      setLoading(false);
    }
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const sorted = [...issues].sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)));
    if (!q) return sorted;
    return sorted.filter((it) => [it.equipmentName, it.issue, it.solution].some((v) => String(v || '').toLowerCase().includes(q)));
  }, [issues, query]);

  async function handleSave() {
    if (!form.equipmentName.trim() || !form.issue.trim()) {
      addToast('설비명과 이슈를 입력하세요.', 'error');
      return;
    }
    setSaving(true);
    const record = {
      ...form,
      equipmentName: form.equipmentName.trim(),
      issue: form.issue.trim(),
      solution: (form.solution || '').trim(),
      updatedAt: new Date().toISOString(),
    };
    try {
      if (record.id) await issueDB.put(record);
      else await issueDB.add(record);
      addToast(record.id ? '이슈를 수정했습니다.' : '이슈를 추가했습니다.', 'success');
      setForm(null);
      load();
    } catch (error) {
      console.error(error);
      addToast(`저장 실패: ${error.message}`, 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(item) {
    if (!confirm(`"${item.equipmentName}" 이슈를 삭제하시겠습니까?`)) return;
    try {
      await issueDB.delete(item.id);
      addToast('이슈를 삭제했습니다.');
      load();
    } catch (error) {
      addToast(`삭제 실패: ${error.message}`, 'error');
    }
  }

  if (missingTable) {
    return (
      <div className="card">
        <div className="empty-state">
          <Wrench size={48} />
          <p>이슈 리스트 테이블이 아직 없습니다.</p>
          <p style={{ marginTop: 8 }}>Supabase SQL Editor에서 <code>supabase/issues.sql</code>을 한 번 실행한 뒤 새로고침하세요.</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="filter-bar" style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <input
          className="form-input"
          placeholder="설비명 · 이슈 · 해결방안 검색"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button className="btn btn-primary" onClick={() => setForm({ ...EMPTY_ISSUE })}>
          <Plus size={15} /> 이슈 추가
        </button>
      </div>

      <div className="card" style={{ padding: 0 }}>
        {loading ? (
          <div style={{ padding: 20, color: 'var(--color-text-muted)' }}>불러오는 중...</div>
        ) : filtered.length === 0 ? (
          <div className="empty-state">
            <Wrench size={48} />
            <p>{query ? '검색 결과가 없습니다.' : '등록된 이슈가 없습니다.'}</p>
          </div>
        ) : (
          <table className="issue-table">
            <thead>
              <tr>
                <th style={{ width: '20%' }}>설비명</th>
                <th style={{ width: '38%' }}>이슈</th>
                <th style={{ width: '38%' }}>해결방안</th>
                <th style={{ width: 80 }}></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((item) => (
                <tr key={item.id}>
                  <td data-label="설비명">
                    <div style={{ fontWeight: 600 }}>{item.equipmentName}</div>
                    <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 2 }}>
                      {formatDateTime(item.updatedAt || item.createdAt)}
                    </div>
                  </td>
                  <td data-label="이슈" className="issue-text">{item.issue}</td>
                  <td data-label="해결방안" className="issue-text">
                    {item.solution || <span style={{ color: 'var(--color-pending)' }}>미해결</span>}
                  </td>
                  <td className="issue-actions">
                    <button className="btn-icon" title="수정" onClick={() => setForm({ ...item })}><Pencil size={15} /></button>
                    <button className="btn-icon" title="삭제" style={{ color: 'var(--color-ng)' }} onClick={() => handleDelete(item)}><Trash2 size={15} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {form && (
        <div className="modal-overlay" onClick={() => setForm(null)}>
          <div className="modal" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">{form.id ? '이슈 수정' : '이슈 추가'}</span>
              <button className="modal-close" onClick={() => setForm(null)}>✕</button>
            </div>
            <div className="form-group">
              <label className="form-label">설비명 *</label>
              <input
                className="form-input"
                list="issue-equipment-names"
                value={form.equipmentName}
                onChange={(e) => setForm({ ...form, equipmentName: e.target.value })}
                placeholder="설비 선택 또는 직접 입력"
              />
              <datalist id="issue-equipment-names">
                {equipmentNames.map((name) => <option key={name} value={name} />)}
              </datalist>
            </div>
            <div className="form-group">
              <label className="form-label">이슈 *</label>
              <textarea
                className="form-input"
                rows={4}
                value={form.issue}
                onChange={(e) => setForm({ ...form, issue: e.target.value })}
                placeholder="발생한 문제, 증상"
              />
            </div>
            <div className="form-group">
              <label className="form-label">해결방안</label>
              <textarea
                className="form-input"
                rows={4}
                value={form.solution}
                onChange={(e) => setForm({ ...form, solution: e.target.value })}
                placeholder="원인, 조치 내용 (비워두면 미해결로 표시)"
              />
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setForm(null)}>취소</button>
              <button className="btn btn-primary" onClick={handleSave} disabled={saving}>{saving ? '저장 중...' : '저장'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

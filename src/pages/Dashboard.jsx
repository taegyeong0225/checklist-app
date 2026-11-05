// 대시보드 페이지 (폴더별/설비별 종합 현황 지원)
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { folderDB, equipmentDB, checklistDB, resultDB } from '../utils/db';
import { calcProgress } from '../utils/helpers';
import { AlertTriangle, CheckCircle, Clock, Server, Folder } from 'lucide-react';

export default function Dashboard() {
  const [folders, setFolders] = useState([]);
  const [equipments, setEquipments] = useState([]);
  const [stats, setStats] = useState({ total: 0, done: 0, ng: 0, pending: 0, folderCount: 0 });
  const [equipmentStats, setEquipmentStats] = useState([]);
  const navigate = useNavigate();

  useEffect(() => {
    load();
  }, []);

  async function load() {
    const [fds, eqs, allCls, allRs] = await Promise.all([
      folderDB.getAll(),
      equipmentDB.getAll(),
      checklistDB.getAll(),
      resultDB.getAll(),
    ]);

    setFolders(fds);
    setEquipments(eqs);

    let doneEq = 0;
    let totalNg = 0;
    let totalPending = 0;

    const eqStats = eqs.map((eq) => {
      const cls = allCls.filter((c) => c.equipmentId === eq.id);
      const parentFolder = fds.find((f) => f.id === eq.folderId);
      if (cls.length === 0) {
        return { eq, parentFolder, pct: 0, ng: 0, pending: 0, hasChecklist: false };
      }
      const cl = cls[cls.length - 1];
      const rs = allRs.filter((r) => r.checklistId === cl.id);
      const prog = calcProgress(cl, rs);
      if (prog.pct === 100) doneEq++;
      totalNg += prog.ng;
      totalPending += prog.pending;
      return { eq, parentFolder, cl, pct: prog.pct, ng: prog.ng, pending: prog.pending, hasChecklist: true };
    });

    setEquipmentStats(eqStats);
    setStats({
      total: eqs.length,
      done: doneEq,
      ng: totalNg,
      pending: totalPending,
      folderCount: fds.length,
    });
  }

  return (
    <div>
      {/* 통계 카드 */}
      <div className="stats-grid">
        <div className="stat-card">
          <Folder size={24} style={{ color: '#f59e0b', marginBottom: 8 }} />
          <div className="stat-value">{stats.folderCount}</div>
          <div className="stat-label">메인 설비 그룹</div>
        </div>
        <div className="stat-card">
          <Server size={24} style={{ color: 'var(--color-primary)', marginBottom: 8 }} />
          <div className="stat-value">{stats.total}</div>
          <div className="stat-label">전체 단위 설비</div>
        </div>
        <div className="stat-card ok">
          <CheckCircle size={24} style={{ color: 'var(--color-ok)', marginBottom: 8 }} />
          <div className="stat-value">{stats.done}</div>
          <div className="stat-label">점검 완료</div>
        </div>
        <div className="stat-card ng">
          <AlertTriangle size={24} style={{ color: 'var(--color-ng)', marginBottom: 8 }} />
          <div className="stat-value">{stats.ng}</div>
          <div className="stat-label">이상 항목</div>
        </div>
      </div>

      {/* 설비별 현황 */}
      <div className="card">
        <div className="card-header">
          <span className="card-title">설비별 점검 현황</span>
          <button className="btn btn-primary btn-sm" onClick={() => navigate('/equipments')}>
            + 설비 관리
          </button>
        </div>

        {equipmentStats.length === 0 ? (
          <div className="empty-state">
            <Server size={48} />
            <p>등록된 설비가 없습니다.</p>
            <p style={{ marginTop: 8 }}>설비 목록에서 메인 설비 폴더 또는 단위 설비를 추가하세요.</p>
            <button
              className="btn btn-primary"
              style={{ marginTop: 16 }}
              onClick={() => navigate('/equipments')}
            >
              설비 추가하기
            </button>
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>메인 그룹 (폴더)</th>
                  <th>단위 설비명</th>
                  <th>호기 / 라인</th>
                  <th>진행률</th>
                  <th>이상</th>
                  <th>상태</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {equipmentStats.map(({ eq, parentFolder, pct, ng, pending, hasChecklist }) => (
                  <tr key={eq.id}>
                    <td>
                      {parentFolder ? (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontWeight: 600, color: '#334155' }}>
                          <Folder size={14} color="#f59e0b" /> {parentFolder.name}
                        </span>
                      ) : (
                        <span style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>- (단독 설비)</span>
                      )}
                    </td>
                    <td style={{ fontWeight: 600 }}>{eq.name}</td>
                    <td>{[eq.unit && `${eq.unit}호기`, eq.line].filter(Boolean).join(' · ') || '-'}</td>
                    <td style={{ minWidth: 140 }}>
                      {hasChecklist ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div className="progress-bar" style={{ flex: 1 }}>
                            <div className="progress-bar-fill" style={{ width: `${pct}%` }} />
                          </div>
                          <span style={{ fontSize: 13, minWidth: 36 }}>{pct}%</span>
                        </div>
                      ) : (
                        <span style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>미점검</span>
                      )}
                    </td>
                    <td>
                      {ng > 0 ? (
                        <span className="badge badge-ng">{ng}</span>
                      ) : '-'}
                    </td>
                    <td>
                      {pending > 0 ? (
                        <span className="badge badge-pending">진행 중</span>
                      ) : hasChecklist ? (
                        <span className="badge badge-ok">완료</span>
                      ) : (
                        <span className="badge badge-na">체크리스트 미생성</span>
                      )}
                    </td>
                    <td>
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => navigate(`/equipments/${eq.id}`)}
                      >
                        상세보기
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

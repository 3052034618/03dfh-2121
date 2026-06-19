import { useState, useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import { API_BASE, formatDateTime, statusBadge, statusText } from '../shared.jsx';

export default function GroupDetail() {
  const { groupId } = useParams();
  const gid = decodeURIComponent(groupId);
  const [group, setGroup] = useState(null);
  const [allCarpools, setAllCarpools] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('all');

  async function load() {
    setLoading(true);
    try {
      const r = await fetch(`${API_BASE}/api/carpools/groups/summary`);
      const d = await r.json();
      const found = (d.groups || []).find(g => g.group_id === gid);
      setGroup(found || null);

      const cr = await fetch(`${API_BASE}/api/carpools?group_id=${encodeURIComponent(gid)}&limit=100`);
      const cdata = await cr.json();
      setAllCarpools(cdata || []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [gid]);

  const activeCarpools = allCarpools.filter(c => ['recruiting', 'locked'].includes(c.status));
  const historyCarpools = allCarpools.filter(c => !['recruiting', 'locked'].includes(c.status));

  const visible = (list) => {
    if (statusFilter === 'all') return list;
    return list.filter(c => c.status === statusFilter);
  };

  if (loading) return <div className="admin-container"><div className="loading">加载中...</div></div>;
  if (!group) return <div className="admin-container"><div className="empty-state">未找到该群数据<br/><br/><Link className="btn" to="/admin/groups">← 返回群列表</Link></div></div>;

  return (
    <div className="admin-container">
      <header className="admin-header">
        <div>
          <h1>💬 {group.group_name}</h1>
          <p className="muted">
            {group.group_id} · 共 {group.total} 场拼车 ·
            {group.recruiting > 0 && <span className="ml-8 recruiting-color"> 招募中 {group.recruiting}</span>}
            {group.locked > 0 && <span className="ml-8 locked-color"> 已锁车 {group.locked}</span>}
            {group.cancelled > 0 && <span className="ml-8 cancelled-color"> 已取消 {group.cancelled}</span>}
          </p>
        </div>
        <div className="header-actions">
          <Link className="btn btn-secondary" to="/admin/groups">← 全部群</Link>
          <Link className="btn" to={`/admin?group_id=${encodeURIComponent(gid)}`}>管理拼车</Link>
        </div>
      </header>

      {activeCarpools.length > 0 && (
        <section className="section">
          <h2>🔥 当前活跃（{activeCarpools.length}）</h2>
          <div className="carpool-list">
            {activeCarpools.map(c => <CarpoolCard key={c.id} carpool={c} />)}
          </div>
        </section>
      )}

      <section className="section">
        <h2>📋 全部拼车</h2>
        <div className="filter-tabs">
          {[
            ['all', `全部（${allCarpools.length}）`],
            ['recruiting', `招募中（${allCarpools.filter(c=>c.status==='recruiting').length}）`],
            ['locked', `已锁车（${allCarpools.filter(c=>c.status==='locked').length}）`],
            ['cancelled', `已取消（${allCarpools.filter(c=>c.status==='cancelled').length}）`],
            ['completed', `已完成（${allCarpools.filter(c=>c.status==='completed').length}）`]
          ].map(([k, l]) => (
            <button key={k}
              className={`tab ${statusFilter === k ? 'active' : ''}`}
              onClick={() => setStatusFilter(k)}>{l}</button>
          ))}
        </div>
        <div className="carpool-list">
          {visible(allCarpools).length === 0 && <div className="empty-state">没有匹配的拼车</div>}
          {visible(allCarpools).map(c => <CarpoolCard key={c.id} carpool={c} />)}
        </div>
      </section>
    </div>
  );
}

function CarpoolCard({ carpool }) {
  return (
    <div className={`carpool-card ${carpool.status}`}>
      <div className="carpool-head">
        <h3>
          <span className={`badge ${statusBadge(carpool.status)}`}>{statusText(carpool.status)}</span>
          {carpool.script_name}
        </h3>
        <span className="muted">{formatDateTime(carpool.start_time)}</span>
      </div>
      <div className="carpool-body">
        <div>📍 {carpool.shop_name}</div>
        <div>👥 {carpool.current_count}/{carpool.need_count} 人</div>
        {carpool.confirmed_players?.length > 0 && (
          <div className="player-tags">
            {carpool.confirmed_players.slice(0, 6).map(p => (
              <span key={p.id} className="player-tag">{p.nickname}</span>
            ))}
            {carpool.confirmed_players.length > 6 && (
              <span className="muted small">+{carpool.confirmed_players.length - 6}</span>
            )}
          </div>
        )}
      </div>
      <div className="carpool-actions">
        <Link className="btn btn-small" to={`/carpool/${carpool.id}`} target="_blank">公开详情</Link>
        <Link className="btn btn-small btn-primary" to={`/admin/carpool/${carpool.id}`}>管理</Link>
      </div>
    </div>
  );
}

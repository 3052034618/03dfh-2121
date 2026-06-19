import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { API_BASE, formatDateTime, statusBadge, statusText } from '../shared.jsx';

export default function GroupOverview() {
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [keyword, setKeyword] = useState('');
  const navigate = useNavigate();

  async function load() {
    setLoading(true);
    try {
      const r = await fetch(`${API_BASE}/api/carpools/groups/summary`);
      const d = await r.json();
      setGroups(d.groups || []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const visibleGroups = groups.filter(g => {
    if (keyword && !(g.group_name.includes(keyword) || g.group_id.includes(keyword))) return false;
    if (filter === 'active') return (g.recruiting + g.locked) > 0;
    if (filter === 'recruiting') return g.recruiting > 0;
    if (filter === 'locked') return g.locked > 0;
    if (filter === 'cancelled') return g.cancelled > 0;
    return true;
  });

  return (
    <div className="admin-container">
      <header className="admin-header">
        <div>
          <h1>📊 群维度拼车总览</h1>
          <p className="muted">共 {groups.length} 个群，最近30天数据</p>
        </div>
        <div className="header-actions">
          <Link className="btn btn-secondary" to="/admin">← 全部拼车</Link>
          <Link className="btn" to="/admin/carpool/new">+ 新建拼车</Link>
        </div>
      </header>

      <div className="filters">
        <input
          className="input"
          placeholder="搜索群名/ID..."
          value={keyword}
          onChange={e => setKeyword(e.target.value)}
          style={{ maxWidth: 280 }}
        />
        <div className="filter-tabs">
          {[
            ['all', '全部'],
            ['active', '招募中/已锁车'],
            ['recruiting', '招募中'],
            ['locked', '已锁车'],
            ['cancelled', '已取消']
          ].map(([k, l]) => (
            <button key={k}
              className={`tab ${filter === k ? 'active' : ''}`}
              onClick={() => setFilter(k)}>{l}</button>
          ))}
        </div>
      </div>

      {loading && <div className="loading">加载中...</div>}
      {!loading && visibleGroups.length === 0 && (
        <div className="empty-state">暂无匹配的群数据</div>
      )}

      <div className="group-list">
        {visibleGroups.map(g => (
          <div key={g.group_id} className="group-card" onClick={() => navigate(`/admin/groups/${encodeURIComponent(g.group_id)}`)}>
            <div className="group-card-head">
              <h3>💬 {g.group_name}</h3>
              <span className="muted small">共 {g.total} 场</span>
            </div>
            <div className="stats-row">
              <div className={`stat recruiting ${g.recruiting > 0 ? 'has' : ''}`}>
                <b>{g.recruiting}</b><span>招募中</span>
              </div>
              <div className={`stat locked ${g.locked > 0 ? 'has' : ''}`}>
                <b>{g.locked}</b><span>已锁车</span>
              </div>
              <div className={`stat cancelled ${g.cancelled > 0 ? 'has' : ''}`}>
                <b>{g.cancelled}</b><span>已取消</span>
              </div>
              <div className="stat completed">
                <b>{g.completed}</b><span>已完成</span>
              </div>
            </div>
            <div className="recent-carpools">
              {g.carpools.slice(0, 4).map(c => (
                <div key={c.id} className="mini-carpool">
                  <span className={`badge ${statusBadge(c.status)}`}>{statusText(c.status)}</span>
                  <span className="mini-title">{c.script_name} @ {c.shop_name}</span>
                  <span className="mini-time">{formatDateTime(c.start_time)}</span>
                  <span className="mini-count">{c.confirmed_count}/{c.need_count}人</span>
                </div>
              ))}
              {g.carpools.length > 4 && (
                <div className="muted small">... 还有 {g.carpools.length - 4} 场，点击查看全部</div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

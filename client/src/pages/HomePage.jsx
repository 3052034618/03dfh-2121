import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

export default function HomePage() {
  const [carpools, setCarpools] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/carpools?status=recruiting&limit=10')
      .then(r => r.json())
      .then(data => {
        setCarpools(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  return (
    <>
      <div className="page-header">
        <h1>🎲 剧本杀拼车助手</h1>
        <p>轻松管理你的拼车局</p>
      </div>

      <div style={{ display: 'flex', gap: '10px', marginBottom: '16px' }}>
        <Link to="/admin" className="btn btn-primary" style={{ textDecoration: 'none' }}>
          🔧 群主管理台
        </Link>
      </div>

      {loading ? (
        <div className="loading">
          <div className="loading-spinner"></div>
          <div>加载中...</div>
        </div>
      ) : carpools.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <div className="empty-icon">🎭</div>
            <div className="empty-text">暂无进行中的拼车</div>
            <div style={{ marginTop: '12px', fontSize: '13px', color: 'var(--text-muted)' }}>
              在群里发送格式正确的"急招"消息即可创建拼车
            </div>
          </div>
        </div>
      ) : (
        carpools.map(c => (
          <Link
            key={c.id}
            to={`/carpool/${c.id}`}
            style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}
          >
            <div className="carpool-list-item">
              <div className="carpool-list-header">
                <span className="carpool-list-name">📖 {c.script_name}</span>
                <span className={`status-badge status-${c.status}`}>
                  {c.status === 'recruiting' ? '招募中' : c.status === 'locked' ? '已锁车' : c.status}
                </span>
              </div>
              <div className="carpool-list-meta">
                <span>📍 {c.shop_name}</span>
                <span>⏰ {formatTime(c.start_time)}</span>
              </div>
              <div className="carpool-list-progress">
                <div className="mini-progress">
                  <div
                    className="mini-progress-fill"
                    style={{ width: `${Math.min(100, (c.current_count / c.need_count) * 100)}%` }}
                  />
                </div>
                <span className="mini-progress-text">{c.current_count}/{c.need_count}</span>
              </div>
            </div>
          </Link>
        ))
      )}
    </>
  );
}

function formatTime(isoString) {
  const d = new Date(isoString);
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';

export default function CarpoolDetail() {
  const { id } = useParams();
  const [carpool, setCarpool] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
    const timer = setInterval(loadData, 15000);
    return () => clearInterval(timer);
  }, [id]);

  function loadData() {
    fetch(`/api/carpools/${id}`)
      .then(r => {
        if (!r.ok) throw new Error();
        return r.json();
      })
      .then(data => {
        setCarpool(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }

  if (loading) {
    return (
      <div className="loading">
        <div className="loading-spinner"></div>
        <div>加载中...</div>
      </div>
    );
  }

  if (!carpool) {
    return (
      <>
        <div className="page-header">
          <Link to="/" className="back-btn">← 返回</Link>
          <h1>❌ 拼车不存在</h1>
        </div>
        <div className="card">
          <div className="empty-state">
            <div className="empty-icon">😕</div>
            <div className="empty-text">该拼车可能已被取消或不存在</div>
          </div>
        </div>
      </>
    );
  }

  const date = new Date(carpool.start_time);
  const timeStr = `${date.getMonth() + 1}月${date.getDate()}日 ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
  const progress = Math.min(100, (carpool.current_count / carpool.need_count) * 100);

  return (
    <>
      <Link to="/" className="back-btn" style={{ position: 'fixed' }}>← 返回</Link>
      <div className="page-header">
        <h1>🎲 {carpool.script_name}</h1>
        <p>{carpool.shop_name}</p>
      </div>

      <div className="card">
        <div className="card-title">
          <span className={`status-badge status-${carpool.status}`}>
            {getStatusText(carpool.status)}
          </span>
        </div>
        <div className="info-row">
          <span className="info-label">📍 店名</span>
          <span className="info-value">{carpool.shop_name}</span>
        </div>
        <div className="info-row">
          <span className="info-label">📖 剧本</span>
          <span className="info-value">{carpool.script_name}</span>
        </div>
        <div className="info-row">
          <span className="info-label">⏰ 时间</span>
          <span className="info-value">{timeStr}</span>
        </div>
        <div className="info-row">
          <span className="info-label">🎭 角色</span>
          <span className="info-value">{carpool.role_requirement || '不限'}</span>
        </div>
        <div className="info-row">
          <span className="info-label">👑 车头</span>
          <span className="info-value">{carpool.owner_nickname}</span>
        </div>

        <div style={{ marginTop: '16px' }}>
          <div className="progress-text">
            {carpool.current_count} / {carpool.need_count} 人
            {carpool.is_full && <span style={{ color: 'var(--success)', marginLeft: '8px' }}>✅ 已凑齐</span>}
          </div>
          <div className="progress-bar">
            <div className="progress-fill" style={{ width: `${progress}%` }} />
          </div>
        </div>
      </div>

      <div className="card">
        <div className="section-title">
          <span>✅ 已确认玩家</span>
          <span className="count-badge">{carpool.confirmed_players.length}</span>
        </div>
        {carpool.confirmed_players.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">🙋</div>
            <div className="empty-text">暂无报名，快在群里回复「上车」吧</div>
          </div>
        ) : (
          <ul className="player-list">
            {carpool.confirmed_players.map((p, i) => (
              <li key={p.id} className="player-item">
                <span className="player-order">{i + 1}</span>
                <div className={`player-avatar ${getAvatarClass(p.gender)}`}>
                  {p.nickname.charAt(0)}
                </div>
                <div className="player-info">
                  <div className="player-name">{p.nickname}</div>
                  <div className="player-meta">
                    {p.gender && <span className="meta-tag">{p.gender}{p.can_crossplay ? '（可反串）' : ''}</span>}
                    {p.arrival_time && <span className="meta-tag">🚗 到店{p.arrival_time}</span>}
                    {p.note && <span className="meta-tag">📝 {p.note}</span>}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {carpool.standby_players.length > 0 && (
        <div className="card">
          <div className="section-title">
            <span>⏳ 候补队列</span>
            <span className="count-badge" style={{ background: 'var(--secondary)' }}>
              {carpool.standby_players.length}
            </span>
          </div>
          <ul className="player-list standby-list">
            {carpool.standby_players.map(p => (
              <li key={p.id} className="player-item">
                <span className="player-order">{p.standby_order}</span>
                <div className={`player-avatar ${getAvatarClass(p.gender)}`}>
                  {p.nickname.charAt(0)}
                </div>
                <div className="player-info">
                  <div className="player-name">{p.nickname}</div>
                  <div className="player-meta">
                    {p.gender && <span className="meta-tag">{p.gender}{p.can_crossplay ? '（可反串）' : ''}</span>}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="card">
        <div className="section-title">
          <span>💬 如何报名</span>
        </div>
        <div style={{ fontSize: '14px', color: 'var(--text-muted)', lineHeight: '1.8' }}>
          在群里发送以下消息即可：
          <br />• 「上车」- 直接报名
          <br />• 「男生可反串」- 带性别说明
          <br />• 「到店20分钟」- 告知到店时间
          <br />• 「候补」- 加入候补队列
        </div>
      </div>
    </>
  );
}

function getStatusText(status) {
  return {
    recruiting: '招募中',
    locked: '已锁车',
    completed: '已完成',
    cancelled: '已取消'
  }[status] || status;
}

function getAvatarClass(gender) {
  if (gender === '男') return 'avatar-male';
  if (gender === '女') return 'avatar-female';
  return 'avatar-default';
}

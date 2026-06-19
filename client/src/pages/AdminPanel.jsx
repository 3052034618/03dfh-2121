import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

const TABS = [
  { key: 'recruiting', label: '招募中' },
  { key: 'locked', label: '已锁车' },
  { key: 'all', label: '全部' }
];

function validateCreateForm(form) {
  const errors = [];
  if (!form.shop_name || !String(form.shop_name).trim()) errors.push('店名不能为空');
  if (!form.script_name || !String(form.script_name).trim()) errors.push('剧本名称不能为空');
  if (!form.start_time) errors.push('请选择发车时间');
  else {
    const t = new Date(form.start_time).getTime();
    if (Number.isNaN(t)) errors.push('发车时间格式错误');
    else if (t < Date.now() - 60 * 60 * 1000) errors.push('发车时间不能早于1小时前');
  }
  const nc = parseInt(form.need_count);
  if (!Number.isFinite(nc) || nc <= 0) errors.push('缺人数必须大于0');
  else if (nc > 30) errors.push('缺人数不能超过30人');
  return errors;
}

export default function AdminPanel() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('recruiting');
  const [carpools, setCarpools] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);

  useEffect(() => {
    loadCarpools();
  }, [activeTab]);

  function loadCarpools() {
    setLoading(true);
    const statusParam = activeTab === 'all' ? '' : `&status=${activeTab}`;
    fetch(`/api/carpools?limit=50${statusParam}`)
      .then(r => r.json())
      .then(data => {
        setCarpools(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }

  function handleCreate(data) {
    fetch('/api/carpools', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...data,
        group_id: 'manual',
        group_name: '手动创建',
        owner_nickname: '管理员'
      })
    }).then(async r => {
      const d = await r.json();
      if (r.ok) {
        setShowCreateModal(false);
        navigate(`/admin/carpool/${d.id}`);
      } else {
        alert('创建失败：' + (d.error || '未知错误'));
      }
    });
  }

  return (
    <>
      <div className="page-header">
        <Link to="/" className="back-btn" style={{ position: 'fixed' }}>← 返回</Link>
        <h1>🔧 群主管理台</h1>
        <p>管理所有拼车局</p>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <Link className="btn btn-primary btn-small" to="/admin/groups" style={{ flex: 1 }}>📊 群维度总览</Link>
      </div>

      <div className="admin-tabs">
        {TABS.map(tab => (
          <div
            key={tab.key}
            className={`admin-tab ${activeTab === tab.key ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
          </div>
        ))}
      </div>

      <button
        className="btn btn-primary"
        style={{ marginBottom: '16px' }}
        onClick={() => setShowCreateModal(true)}
      >
        ➕ 手动创建拼车
      </button>

      {loading ? (
        <div className="loading">
          <div className="loading-spinner"></div>
          <div>加载中...</div>
        </div>
      ) : carpools.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <div className="empty-icon">🎭</div>
            <div className="empty-text">暂无拼车记录</div>
          </div>
        </div>
      ) : (
        carpools.map(c => (
          <div
            key={c.id}
            className="carpool-list-item"
            onClick={() => navigate(`/admin/carpool/${c.id}`)}
          >
            <div className="carpool-list-header">
              <span className="carpool-list-name">📖 {c.script_name}</span>
              <span className={`status-badge status-${c.status}`}>
                {c.status === 'recruiting' ? '招募中' : c.status === 'locked' ? '已锁车' : c.status === 'completed' ? '已完成' : '已取消'}
              </span>
            </div>
            <div className="carpool-list-meta">
              <span>📍 {c.shop_name}</span>
              <span>⏰ {formatTime(c.start_time)}</span>
              <span>👑 {c.owner_nickname}</span>
              {c.group_name && <span>💬 {c.group_name}</span>}
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
            {c.standby_players.length > 0 && (
              <div style={{ marginTop: '8px', fontSize: '12px', color: 'var(--secondary)' }}>
                ⏳ 候补 {c.standby_players.length} 人
              </div>
            )}
          </div>
        ))
      )}

      {showCreateModal && (
        <CreateCarpoolModal
          onClose={() => setShowCreateModal(false)}
          onSubmit={handleCreate}
        />
      )}
    </>
  );
}

function formatTime(isoString) {
  const d = new Date(isoString);
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

function CreateCarpoolModal({ onClose, onSubmit }) {
  const [form, setForm] = useState({
    shop_name: '',
    script_name: '',
    start_time: '',
    need_count: 6,
    role_requirement: ''
  });
  const [errors, setErrors] = useState([]);

  function submit() {
    const errs = validateCreateForm(form);
    if (errs.length > 0) {
      setErrors(errs);
      return;
    }
    setErrors([]);
    onSubmit({
      ...form,
      start_time: new Date(form.start_time).toISOString()
    });
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-title">创建新拼车</div>
        <div className="modal-body">
          {errors.length > 0 && (
            <div className="form-errors">
              {errors.map((e, i) => <div key={i}>⚠️ {e}</div>)}
            </div>
          )}
          <label className="input-label">店名 *</label>
          <input
            className="input"
            placeholder="如：推理俱乐部"
            value={form.shop_name}
            onChange={e => setForm({ ...form, shop_name: e.target.value })}
          />
          <label className="input-label">剧本名 *</label>
          <input
            className="input"
            placeholder="如：雾鸦馆"
            value={form.script_name}
            onChange={e => setForm({ ...form, script_name: e.target.value })}
          />
          <div className="row">
            <div className="input-wrapper">
              <label className="input-label">开始时间 *</label>
              <input
                type="datetime-local"
                className="input"
                value={form.start_time}
                onChange={e => setForm({ ...form, start_time: e.target.value })}
              />
            </div>
            <div className="input-wrapper">
              <label className="input-label">需要人数 *</label>
              <input
                type="number"
                className="input"
                min={1}
                max={30}
                value={form.need_count}
                onChange={e => setForm({ ...form, need_count: parseInt(e.target.value) || 0 })}
              />
            </div>
          </div>
          <label className="input-label">角色要求（可选）</label>
          <input
            className="input"
            placeholder="如：3男3女可反串"
            value={form.role_requirement}
            onChange={e => setForm({ ...form, role_requirement: e.target.value })}
          />
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>取消</button>
          <button className="btn btn-primary" onClick={submit}>创建</button>
        </div>
      </div>
    </div>
  );
}

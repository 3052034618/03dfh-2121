import { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { validateCarpoolForm } from '../shared.jsx';

export default function AdminCarpoolDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [carpool, setCarpool] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showAddPlayer, setShowAddPlayer] = useState(false);
  const [showEditCarpool, setShowEditCarpool] = useState(false);

  useEffect(() => {
    loadData();
  }, [id]);

  function loadData() {
    fetch(`/api/carpools/${id}`)
      .then(r => r.json())
      .then(data => {
        setCarpool(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }

  function updateStatus(status) {
    fetch(`/api/carpools/${id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status })
    }).then(() => loadData());
  }

  function addPlayer(data) {
    fetch('/api/players', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...data, carpool_id: id })
    }).then(async r => {
      const d = await r.json();
      if (r.ok) {
        setShowAddPlayer(false);
        loadData();
      } else {
        alert('添加失败：' + (d.error || '未知错误'));
      }
    });
  }

  function cancelPlayer(playerId) {
    if (!confirm('确认移除该玩家？')) return;
    fetch(`/api/players/${playerId}/cancel`, {
      method: 'POST'
    }).then(() => loadData());
  }

  function promotePlayer(playerId) {
    fetch(`/api/players/${playerId}/promote`, {
      method: 'POST'
    }).then(() => loadData());
  }

  function deleteCarpool() {
    if (!confirm('确认删除该拼车？此操作不可撤销。')) return;
    fetch(`/api/carpools/${id}`, { method: 'DELETE' })
      .then(() => navigate('/admin'));
  }

  function saveEdit(data) {
    setShowEditCarpool(false);
    loadData();
  }

  if (loading || !carpool) {
    return (
      <div className="loading">
        <div className="loading-spinner"></div>
        <div>加载中...</div>
      </div>
    );
  }

  const date = new Date(carpool.start_time);
  const timeStr = `${date.getMonth() + 1}月${date.getDate()}日 ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;

  return (
    <>
      <Link to="/admin" className="back-btn" style={{ position: 'fixed' }}>← 返回</Link>
      <div className="page-header">
        <h1>🔧 拼车管理</h1>
        <p>{carpool.script_name}</p>
      </div>

      <div className="card">
        <div className="card-title">
          <span className={`status-badge status-${carpool.status}`}>
            {carpool.status === 'recruiting' ? '招募中' : carpool.status === 'locked' ? '已锁车' : carpool.status === 'completed' ? '已完成' : '已取消'}
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
          <span className="info-label">👥 人数</span>
          <span className="info-value">{carpool.current_count}/{carpool.need_count}（差{carpool.remaining_count}）</span>
        </div>
        <div className="info-row">
          <span className="info-label">🎭 角色</span>
          <span className="info-value">{carpool.role_requirement || '不限'}</span>
        </div>

        <div className="btn-group" style={{ marginTop: '16px' }}>
          <button className="btn btn-secondary" onClick={() => setShowEditCarpool(true)}>✏️ 编辑</button>
          <button className="btn btn-danger" onClick={deleteCarpool}>🗑️ 删除</button>
        </div>

        {carpool.status === 'recruiting' && (
          <button
            className="btn btn-success"
            style={{ marginTop: '10px' }}
            onClick={() => updateStatus('locked')}
          >
            🔒 锁车
          </button>
        )}
        {carpool.status === 'locked' && (
          <button
            className="btn btn-secondary"
            style={{ marginTop: '10px' }}
            onClick={() => updateStatus('recruiting')}
          >
            🔓 解锁
          </button>
        )}
        {carpool.status !== 'cancelled' && carpool.status !== 'completed' && (
          <button
            className="btn btn-secondary"
            style={{ marginTop: '10px' }}
            onClick={() => updateStatus('completed')}
          >
            ✅ 标记完成
          </button>
        )}
      </div>

      <div className="card">
        <div className="section-title">
          <span>✅ 已确认玩家 ({carpool.confirmed_players.length})</span>
          <button
            className="btn btn-primary btn-small"
            onClick={() => setShowAddPlayer(true)}
          >
            ➕ 添加
          </button>
        </div>
        {carpool.confirmed_players.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">🙋</div>
            <div className="empty-text">暂无玩家</div>
          </div>
        ) : (
          <ul className="player-list">
            {carpool.confirmed_players.map((p, i) => (
              <li key={p.id} className="player-item">
                <span className="player-order">{i + 1}</span>
                <div className={`player-avatar ${p.gender === '男' ? 'avatar-male' : p.gender === '女' ? 'avatar-female' : 'avatar-default'}`}>
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
                <div className="player-actions">
                  <button
                    className="btn btn-danger btn-small"
                    onClick={() => cancelPlayer(p.id)}
                  >
                    移除
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="card">
        <div className="section-title">
          <span>⏳ 候补队列 ({carpool.standby_players.length})</span>
        </div>
        {carpool.standby_players.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">⌛</div>
            <div className="empty-text">暂无候补</div>
          </div>
        ) : (
          <ul className="player-list standby-list">
            {carpool.standby_players.map(p => (
              <li key={p.id} className="player-item">
                <span className="player-order">{p.standby_order}</span>
                <div className={`player-avatar ${p.gender === '男' ? 'avatar-male' : p.gender === '女' ? 'avatar-female' : 'avatar-default'}`}>
                  {p.nickname.charAt(0)}
                </div>
                <div className="player-info">
                  <div className="player-name">{p.nickname}</div>
                  <div className="player-meta">
                    {p.gender && <span className="meta-tag">{p.gender}{p.can_crossplay ? '（可反串）' : ''}</span>}
                  </div>
                </div>
                <div className="player-actions">
                  <button
                    className="btn btn-success btn-small"
                    onClick={() => promotePlayer(p.id)}
                    disabled={carpool.confirmed_players.length >= carpool.need_count}
                  >
                    转正
                  </button>
                  <button
                    className="btn btn-danger btn-small"
                    onClick={() => cancelPlayer(p.id)}
                  >
                    移除
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {showAddPlayer && (
        <AddPlayerModal
          onClose={() => setShowAddPlayer(false)}
          onSubmit={addPlayer}
        />
      )}

      {showEditCarpool && (
        <EditCarpoolModal
          carpool={carpool}
          onClose={() => setShowEditCarpool(false)}
          onSubmit={saveEdit}
        />
      )}
    </>
  );
}

function AddPlayerModal({ onClose, onSubmit }) {
  const [form, setForm] = useState({
    nickname: '',
    gender: '',
    can_crossplay: false,
    arrival_time: '',
    note: '',
    is_standby: false
  });

  function submit() {
    if (!form.nickname) {
      alert('请输入玩家昵称');
      return;
    }
    onSubmit(form);
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-title">添加玩家</div>
        <div className="modal-body">
          <label className="input-label">昵称 *</label>
          <input
            className="input"
            placeholder="玩家微信昵称"
            value={form.nickname}
            onChange={e => setForm({ ...form, nickname: e.target.value })}
          />
          <div className="row">
            <div className="input-wrapper">
              <label className="input-label">性别</label>
              <select
                className="input"
                value={form.gender}
                onChange={e => setForm({ ...form, gender: e.target.value })}
              >
                <option value="">未知</option>
                <option value="男">男</option>
                <option value="女">女</option>
              </select>
            </div>
            <div className="input-wrapper">
              <label className="input-label">到店时间</label>
              <input
                className="input"
                placeholder="如：20分钟"
                value={form.arrival_time}
                onChange={e => setForm({ ...form, arrival_time: e.target.value })}
              />
            </div>
          </div>
          <label className="input-label">备注</label>
          <input
            className="input"
            placeholder="如：带1人"
            value={form.note}
            onChange={e => setForm({ ...form, note: e.target.value })}
          />
          <div style={{ display: 'flex', gap: '16px', marginTop: '8px' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '14px' }}>
              <input
                type="checkbox"
                checked={form.can_crossplay}
                onChange={e => setForm({ ...form, can_crossplay: e.target.checked })}
              />
              可反串
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '14px' }}>
              <input
                type="checkbox"
                checked={form.is_standby}
                onChange={e => setForm({ ...form, is_standby: e.target.checked })}
              />
              加入候补
            </label>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>取消</button>
          <button className="btn btn-primary" onClick={submit}>添加</button>
        </div>
      </div>
    </div>
  );
}

function EditCarpoolModal({ carpool, onClose, onSubmit }) {
  const d = new Date(carpool.start_time);
  const localTime = `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}-${d.getDate().toString().padStart(2, '0')}T${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;

  const [form, setForm] = useState({
    shop_name: carpool.shop_name,
    script_name: carpool.script_name,
    start_time: localTime,
    need_count: carpool.need_count,
    role_requirement: carpool.role_requirement
  });
  const [errors, setErrors] = useState([]);
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    const errs = validateCarpoolForm(form);
    if (errs.length > 0) {
      setErrors(errs);
      return;
    }
    setErrors([]);
    setSubmitting(true);

    const submitData = {
      ...form,
      start_time: new Date(form.start_time).toISOString()
    };

    try {
      const res = await fetch(`/api/carpools/${carpool.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(submitData)
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || '保存失败');
      }
      onSubmit(submitData);
    } catch (err) {
      setErrors([err.message]);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-title">编辑拼车</div>
        <div className="modal-body">
          {errors.length > 0 && (
            <div className="form-errors">
              {errors.map((e, i) => <div key={i}>⚠️ {e}</div>)}
            </div>
          )}
          <label className="input-label">店名</label>
          <input
            className="input"
            value={form.shop_name}
            onChange={e => setForm({ ...form, shop_name: e.target.value })}
          />
          <label className="input-label">剧本名</label>
          <input
            className="input"
            value={form.script_name}
            onChange={e => setForm({ ...form, script_name: e.target.value })}
          />
          <div className="row">
            <div className="input-wrapper">
              <label className="input-label">开始时间</label>
              <input
                type="datetime-local"
                className="input"
                value={form.start_time}
                onChange={e => setForm({ ...form, start_time: e.target.value })}
              />
            </div>
            <div className="input-wrapper">
              <label className="input-label">需要人数</label>
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
          <label className="input-label">角色要求</label>
          <input
            className="input"
            value={form.role_requirement}
            onChange={e => setForm({ ...form, role_requirement: e.target.value })}
          />
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose} disabled={submitting}>取消</button>
          <button className="btn btn-primary" onClick={submit} disabled={submitting}>
            {submitting ? '保存中...' : '保存'}
          </button>
        </div>
      </div>
    </div>
  );
}

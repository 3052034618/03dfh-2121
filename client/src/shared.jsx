export const API_BASE = window.location.origin.includes('localhost')
  ? 'http://localhost:3000'
  : '';

export function validateCarpoolForm(form) {
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

export function formatDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const isTomorrow = d.toDateString() === tomorrow.toDateString();
  const pad = n => n.toString().padStart(2, '0');
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (sameDay) return `今天 ${time}`;
  if (isTomorrow) return `明天 ${time}`;
  return `${d.getMonth() + 1}/${d.getDate()} ${time}`;
}

export function statusBadge(status) {
  return {
    recruiting: 'badge-recruiting',
    locked: 'badge-locked',
    cancelled: 'badge-cancelled',
    completed: 'badge-completed'
  }[status] || '';
}

export function statusText(status) {
  return {
    recruiting: '招募中',
    locked: '已锁车',
    cancelled: '已取消',
    completed: '已完成'
  }[status] || status;
}

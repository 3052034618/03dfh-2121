export const API_BASE = window.location.origin.includes('localhost')
  ? 'http://localhost:3000'
  : '';

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

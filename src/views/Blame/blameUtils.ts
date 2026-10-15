export function formatRelativeDate(timestampSec: number, nowSec?: number): string {
  const now = nowSec ?? Math.floor(Date.now() / 1000);
  const diff = Math.max(0, now - timestampSec);

  if (diff < 60) {
    return "just now";
  }
  const minutes = Math.floor(diff / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  const days = Math.floor(hours / 24);
  if (days < 30) {
    return `${days}d ago`;
  }
  const months = Math.floor(days / 30);
  if (months < 12) {
    return `${months}mo ago`;
  }
  const years = Math.floor(days / 365);
  return `${years}y ago`;
}

export function getCommitAgeColor(timestampSec: number, nowSec?: number): string {
  const now = nowSec ?? Math.floor(Date.now() / 1000);
  const diffDays = Math.max(0, (now - timestampSec) / 86400);

  if (diffDays <= 7) {
    return "#f59e0b"; // vibrant amber
  }
  if (diffDays <= 30) {
    return "#eab308"; // yellow
  }
  if (diffDays <= 90) {
    return "#10b981"; // emerald
  }
  if (diffDays <= 180) {
    return "#06b6d4"; // cyan
  }
  if (diffDays <= 365) {
    return "#3b82f6"; // blue
  }
  return "#64748b"; // muted slate
}

// Settings and the data shown on the page (loaded from the server after login)
const DAYS = [
  ["Monday", "MON", "#2563eb"], ["Tuesday", "TUE", "#7c3aed"], ["Wednesday", "WED", "#059669"],
  ["Thursday", "THU", "#d97706"], ["Friday", "FRI", "#0891b2"], ["Saturday", "SAT", "#4f46e5"], ["Sunday", "SUN", "#e11d48"]
];
const CAT_COLORS = { main: "#1e3a8a", study: "#0d9488", special: "#6d28d9", break: "#e2e8f0" };
const ROW_H = 58; // px per hour
let state = { tasks: [], schedules: [] };
let taskFilter = "all";

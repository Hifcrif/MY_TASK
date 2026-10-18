// Tasks
$("taskForm").onsubmit = async e => {
  e.preventDefault();
  const form = e.target, button = form.querySelector("button[type=submit]");
  button.disabled = true;
  try {
    state.tasks.push(await Api.post("/api/tasks", { title: $("tTitle").value, due: $("tDue").value, prio: $("tPrio").value }));
    form.reset();
    render();
  } catch (err) { notify(err.message); }
  button.disabled = false;
};

document.querySelectorAll("#taskFilters button").forEach(b => b.onclick = () => {
  taskFilter = b.dataset.f;
  document.querySelectorAll("#taskFilters button").forEach(x => x.classList.toggle("active", x === b));
  renderTasks();
});
$("taskList").addEventListener("change", e => { if (e.target.dataset.toggle) toggleTask(e.target.dataset.toggle); });
$("taskList").addEventListener("click", e => { const b = e.target.closest("[data-del]"); if (b) delTask(b.dataset.del); });

function renderTasks() {
  const list = state.tasks.filter(t => taskFilter === "all" || (taskFilter === "done") === t.done)
    .sort((a, b) => a.done - b.done || (a.due || "9999").localeCompare(b.due || "9999"));
  $("taskList").innerHTML = list.length ? list.map(t => `
    <div class="item ${t.done ? "done" : ""}">
      <input type="checkbox" style="width:auto;margin-top:4px" ${t.done ? "checked" : ""} data-toggle="${esc(t.id)}">
      <div class="body">
        <div class="title">${esc(t.title)}<span class="badge ${esc(t.prio)}">${esc(t.prio)}</span></div>
        <div class="meta ${!t.done && t.due && t.due < today() ? "overdue" : ""}">${t.due ? "Due " + fmtDate(t.due) : "No due date"}</div>
        ${linkedInfo(t)}
      </div>
      <button class="del" title="Delete" data-del="${esc(t.id)}">✕</button>
    </div>`).join("") : `<div class="empty">No tasks yet</div>`;
  // keep the "link a task" dropdown in the schedule form up to date
  const cur = $("sTask").value;
  $("sTask").innerHTML = `<option value="">— none —</option>` +
    state.tasks.filter(t => !t.done).map(t => `<option value="${esc(t.id)}">${esc(t.title)}</option>`).join("");
  $("sTask").value = state.tasks.some(t => t.id === cur && !t.done) ? cur : "";
}
function linkedInfo(t) {
  const sch = state.schedules.filter(s => s.taskId === t.id).sort((a, b) => a.day - b.day || a.start.localeCompare(b.start));
  if (!sch.length) return "";
  return `<div class="meta tasklink">🔗 ${sch.map(s => `${DAYS[s.day][1]} ${esc(s.start)}-${esc(s.end)} (${esc(s.title)})`).join(", ")}</div>`;
}

async function toggleTask(id) {
  const t = state.tasks.find(t => t.id === id);
  if (!t) return;
  try { Object.assign(t, await Api.patch("/api/tasks/" + id, { done: !t.done })); } catch (err) { notify(err.message); }
  render();
}
async function delTask(id) {
  try {
    await Api.del("/api/tasks/" + id);
    state.tasks = state.tasks.filter(t => t.id !== id);
    state.schedules.forEach(s => { if (s.taskId === id) s.taskId = ""; });
  } catch (err) { notify(err.message); }
  render();
}

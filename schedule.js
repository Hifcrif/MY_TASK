// Weekly schedule
$("schForm").onsubmit = async e => {
  e.preventDefault();
  const start = $("sStart").value, end = $("sEnd").value;
  if (toMin(end) <= toMin(start)) { notify("End time must be after start time."); return; }
  const button = e.target.querySelector("button[type=submit]");
  button.disabled = true;
  try {
    state.schedules.push(await Api.post("/api/schedules", {
      title: $("sTitle").value, day: Number($("sDay").value), start, end,
      cat: $("sCat").value, notes: $("sNotes").value, taskId: $("sTask").value,
    }));
    $("sTitle").value = ""; $("sNotes").value = ""; $("sTask").value = "";
    render();
  } catch (err) { notify(err.message); }
  button.disabled = false;
};
// picking a task fills the title if it is still empty
$("sTask").onchange = () => {
  const t = state.tasks.find(t => t.id === $("sTask").value);
  if (t && !$("sTitle").value.trim()) $("sTitle").value = t.title;
};
$("timetable").addEventListener("click", e => { const b = e.target.closest("[data-del-sch]"); if (b) delSch(b.dataset.delSch); });

function renderTimetable() {
  const el = $("timetable");
  const list = state.schedules;
  const numDays = list.some(s => s.day >= 5) ? 7 : 5;

  let startH = 8, endH = 18;
  if (list.length) {
    startH = Math.min(8, Math.floor(Math.min(...list.map(s => toMin(s.start))) / 60));
    endH = Math.max(18, Math.ceil(Math.max(...list.map(s => toMin(s.end))) / 60));
  }
  const totalH = (endH - startH) * ROW_H;

  el.className = "timetable";
  el.style.gridTemplateColumns = `110px repeat(${numDays}, minmax(0, 1fr))`;

  let html = `<div class="th time">Time</div>`;
  for (let d = 0; d < numDays; d++) {
    const [full, short, color] = DAYS[d];
    html += `<div class="th ${d === todayIdx() ? "today" : ""}" style="background:${color};color:#fff"><span style="color:#fff">${full}<br>(${short})</span></div>`;
  }

  let tcells = "";
  for (let h = startH; h < endH; h++) {
    tcells += `<div class="tcell" style="top:${(h - startH) * ROW_H + 2}px;height:${ROW_H - 4}px">${pad(h)}:00 - ${pad(h + 1)}:00</div>`;
  }
  html += `<div class="timecol" style="height:${totalH}px">${tcells}</div>`;

  for (let d = 0; d < numDays; d++) {
    let hcells = "";
    for (let h = startH; h < endH; h++) {
      hcells += `<div class="hcell" style="top:${(h - startH) * ROW_H + 2}px;height:${ROW_H - 4}px">-</div>`;
    }
    const items = list.filter(s => s.day === d).sort((a, b) => toMin(a.start) - toMin(b.start));
    const laneEnds = [];
    items.forEach(s => {
      let lane = laneEnds.findIndex(end => end <= toMin(s.start));
      if (lane === -1) { lane = laneEnds.length; laneEnds.push(0); }
      laneEnds[lane] = toMin(s.end);
      s._lane = lane;
    });
    const lanes = Math.max(1, laneEnds.length);
    const blocks = items.map(s => {
      const top = (toMin(s.start) - startH * 60) / 60 * ROW_H;
      const height = Math.max(26, (toMin(s.end) - toMin(s.start)) / 60 * ROW_H - 4);
      const w = 100 / lanes;
      const task = state.tasks.find(t => t.id === s.taskId);
      const cat = CAT_COLORS[s.cat] ? s.cat : "main";
      return `<div class="block cat-${cat}" style="top:${top + 2}px;height:${height}px;left:calc(${s._lane * w}% + 1px);width:calc(${w}% - 2px);background:${CAT_COLORS[cat]}">
        <button class="x" title="Remove" data-del-sch="${esc(s.id)}">✕</button>
        <b>${esc(s.title)}</b><small>${esc(s.start)} - ${esc(s.end)}${s.notes ? " · " + esc(s.notes) : ""}</small>${task ? `<small class="tk">${task.done ? "✔" : "🔗"} ${esc(task.title)}</small>` : ""}
      </div>`;
    }).join("");
    html += `<div class="daycol ${d === todayIdx() ? "today" : ""}" style="height:${totalH}px">${hcells}${blocks}</div>`;
  }
  el.innerHTML = html;
}
async function delSch(id) {
  try {
    await Api.del("/api/schedules/" + id);
    state.schedules = state.schedules.filter(s => s.id !== id);
  } catch (err) { notify(err.message); }
  render();
}

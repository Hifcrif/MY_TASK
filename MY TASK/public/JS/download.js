// Download the weekly timetable as a PNG image (drawn on a canvas, works offline)
function downloadPNG() {
  const list = state.schedules;
  const numDays = list.some(s => s.day >= 5) ? 7 : 5;
  let startH = 8, endH = 18;
  if (list.length) {
    startH = Math.min(8, Math.floor(Math.min(...list.map(s => toMin(s.start))) / 60));
    endH = Math.max(18, Math.ceil(Math.max(...list.map(s => toMin(s.end))) / 60));
  }
  const S = 2, pad0 = 24, gap = 8, timeW = 130, hdrH = 56, rowH = 60, W = 1400, bannerH = 96;
  const dayW = (W - pad0 * 2 - timeW - gap * numDays) / numDays;
  const tableY = pad0 + bannerH + 20;
  const bodyY = tableY + hdrH + gap;
  const bodyH = (endH - startH) * rowH;
  const legendY = bodyY + bodyH + 28;
  const H = legendY + 40 + pad0;
  const dayX = d => pad0 + timeW + gap + d * (dayW + gap);

  const c = document.createElement("canvas");
  c.width = W * S; c.height = H * S;
  const ctx = c.getContext("2d");
  ctx.scale(S, S);
  const FONT = '"Noto Sans Thai","Segoe UI",system-ui,sans-serif';

  const rr = (x, y, w, h, r) => {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  };
  const fit = (t, maxW) => {
    if (ctx.measureText(t).width <= maxW) return t;
    while (t.length > 1 && ctx.measureText(t + "…").width > maxW) t = t.slice(0, -1);
    return t + "…";
  };
  const text = (t, x, y, font, color, maxW) => {
    ctx.font = font; ctx.fillStyle = color; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(maxW ? fit(t, maxW) : t, x, y);
  };

  // page + banner
  ctx.fillStyle = "#f8fafc"; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#0f172a"; rr(pad0, pad0, W - pad0 * 2, bannerH, 24); ctx.fill();
  text("Weekly Schedule & Tasks", W / 2, pad0 + 36, `700 30px ${FONT}`, "#ffffff");
  text("Classes, study sessions and to-dos in one place (Monday – Sunday)", W / 2, pad0 + 68, `400 16px ${FONT}`, "#94a3b8");

  // headers
  ctx.fillStyle = "#334155"; rr(pad0, tableY, timeW, hdrH, 12); ctx.fill();
  text("Time", pad0 + timeW / 2, tableY + hdrH / 2, `700 16px ${FONT}`, "#ffffff");
  for (let d = 0; d < numDays; d++) {
    const [full, short, color] = DAYS[d], x = dayX(d);
    ctx.fillStyle = color; rr(x, tableY, dayW, hdrH, 12); ctx.fill();
    if (d === todayIdx()) { ctx.strokeStyle = color; ctx.lineWidth = 2; rr(x - 3, tableY - 3, dayW + 6, hdrH + 6, 14); ctx.stroke(); }
    text(full, x + dayW / 2, tableY + 20, `700 15px ${FONT}`, "#ffffff");
    text(`(${short})`, x + dayW / 2, tableY + 40, `700 15px ${FONT}`, "#ffffff");
  }

  // time column + empty cells
  for (let h = startH; h < endH; h++) {
    const y = bodyY + (h - startH) * rowH + 2;
    ctx.fillStyle = "#f1f5f9"; ctx.strokeStyle = "#cbd5e1"; ctx.lineWidth = 1;
    rr(pad0, y, timeW, rowH - 4, 12); ctx.fill(); ctx.stroke();
    text(`${pad(h)}:00 - ${pad(h + 1)}:00`, pad0 + timeW / 2, y + (rowH - 4) / 2, `700 14px ${FONT}`, "#334155");
    for (let d = 0; d < numDays; d++) {
      ctx.fillStyle = d === todayIdx() ? "#eff6ff" : "#ffffff"; ctx.strokeStyle = "#e2e8f0";
      rr(dayX(d), y, dayW, rowH - 4, 12); ctx.fill(); ctx.stroke();
      text("-", dayX(d) + dayW / 2, y + (rowH - 4) / 2, `400 13px ${FONT}`, "#cbd5e1");
    }
  }

  // class blocks
  for (let d = 0; d < numDays; d++) {
    const items = list.filter(s => s.day === d).sort((a, b) => toMin(a.start) - toMin(b.start));
    const laneEnds = [];
    const lane = new Map();
    items.forEach(s => {
      let l = laneEnds.findIndex(end => end <= toMin(s.start));
      if (l === -1) { l = laneEnds.length; laneEnds.push(0); }
      laneEnds[l] = toMin(s.end); lane.set(s.id, l);
    });
    const lanes = Math.max(1, laneEnds.length);
    items.forEach(s => {
      const cat = CAT_COLORS[s.cat] ? s.cat : "main";
      const top = bodyY + (toMin(s.start) - startH * 60) / 60 * rowH + 2;
      const h = Math.max(26, (toMin(s.end) - toMin(s.start)) / 60 * rowH - 4);
      const w = dayW / lanes, x = dayX(d) + lane.get(s.id) * w + 1, bw = w - 2;
      ctx.fillStyle = CAT_COLORS[cat];
      ctx.strokeStyle = cat === "break" ? "#cbd5e1" : "rgba(0,0,0,.18)";
      rr(x, top, bw, h, 12); ctx.fill(); ctx.stroke();
      const color = cat === "break" ? "#334155" : "#ffffff";
      const sub = `${s.start} - ${s.end}${s.notes ? " · " + s.notes : ""}`;
      const cx = x + bw / 2, cy = top + h / 2;
      const task = state.tasks.find(t => t.id === s.taskId);
      const taskLine = task ? `${task.done ? "✔" : "🔗"} ${task.title}` : "";
      if (taskLine && h >= 64) {
        text(s.title, cx, cy - 17, `700 14px ${FONT}`, color, bw - 12);
        text(sub, cx, cy + 1, `400 12px ${FONT}`, color, bw - 12);
        text(taskLine, cx, cy + 18, `600 12px ${FONT}`, color, bw - 12);
      } else if (h >= 42) {
        text(s.title, cx, cy - 9, `700 14px ${FONT}`, color, bw - 12);
        text(sub, cx, cy + 10, `400 12px ${FONT}`, color, bw - 12);
      } else {
        text(`${s.title}  ${s.start}-${s.end}`, cx, cy, `700 12px ${FONT}`, color, bw - 12);
      }
    });
  }

  // legend
  const legend = [["Main class", CAT_COLORS.main], ["Study / Project", CAT_COLORS.study],
                  ["Special class", CAT_COLORS.special], ["Break / Meal", CAT_COLORS.break]];
  let lx = pad0 + 10;
  legend.forEach(([label, color]) => {
    ctx.fillStyle = color; ctx.strokeStyle = "rgba(0,0,0,.12)";
    rr(lx, legendY, 44, 24, 7); ctx.fill(); ctx.stroke();
    ctx.font = `600 15px ${FONT}`; ctx.fillStyle = "#1e293b"; ctx.textAlign = "left"; ctx.textBaseline = "middle";
    ctx.fillText(label, lx + 56, legendY + 12);
    lx += 56 + ctx.measureText(label).width + 40;
  });

  c.toBlob(blob => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `weekly-schedule-${today()}.png`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }, "image/png");
}

$("dlBtn").onclick = downloadPNG;

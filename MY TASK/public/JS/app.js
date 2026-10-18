// Start the app: check the login, load this account's data from the server, draw the page
function render() { renderTasks(); renderTimetable(); }

$("logoutBtn").onclick = Auth.logout;

(async function start() {
  try {
    const user = await Auth.me();
    if (!user) { location.replace("login.html"); return; }
    $("whoami").textContent = "👤 " + user.username;
    const data = await Api.get("/api/data");
    state.tasks = data.tasks;
    state.schedules = data.schedules;
  } catch (err) {
    $("loading").textContent = err.message + " Reload the page to try again.";
    return;
  }
  render();
  $("loading").hidden = true;
  $("app").hidden = false; // show the page only once the data has arrived
})();

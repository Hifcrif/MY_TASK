// Login / create account page
const $ = id => document.getElementById(id);
let mode = "login";

// already logged in? go straight to the app
Auth.me().then(user => { if (user) location.replace("index.html"); });

function setMode(m) {
  mode = m;
  $("tabLogin").classList.toggle("active", m === "login");
  $("tabRegister").classList.toggle("active", m === "register");
  $("confirmBox").hidden = m === "login";
  $("pass2").required = m === "register";
  $("authSubmit").textContent = m === "login" ? "Log in" : "Create account";
  $("pass").autocomplete = m === "login" ? "current-password" : "new-password";
  $("authTitle").textContent = m === "login" ? "Welcome back" : "Create your account";
  $("authHelp").textContent = m === "login" ? "Log in to open your schedule and tasks." : "Pick a username and a password (8+ characters).";
  showMsg("");
}
function showMsg(text) { $("authMsg").textContent = text; $("authMsg").hidden = !text; }

$("tabLogin").onclick = () => setMode("login");
$("tabRegister").onclick = () => setMode("register");
$("showPass").onchange = e => { $("pass").type = $("pass2").type = e.target.checked ? "text" : "password"; };

$("authForm").onsubmit = async e => {
  e.preventDefault();
  showMsg("");
  const user = $("user").value, pass = $("pass").value, keep = $("keep").checked;
  if (mode === "register" && pass !== $("pass2").value) { showMsg("The two passwords do not match."); return; }
  $("authSubmit").disabled = true;
  try {
    await (mode === "login" ? Auth.login(user, pass, keep) : Auth.register(user, pass, keep));
    location.replace("index.html");
  } catch (err) {
    showMsg(err.message);
    $("authSubmit").disabled = false;
  }
};

setMode("login");

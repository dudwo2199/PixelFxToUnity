import "./boot-error.css";

import("./main.jsx").catch((error) => {
  const root = document.getElementById("root");
  if (!root) return;
  const panel = document.createElement("main");
  panel.className = "boot-error";
  const title = document.createElement("h1");
  title.textContent = "앱을 불러오지 못했습니다";
  const message = document.createElement("p");
  message.textContent = error?.message || String(error);
  const detail = document.createElement("pre");
  detail.textContent = error?.stack || "개발자 도구 콘솔에서 자세한 오류를 확인해 주세요.";
  panel.append(title, message, detail);
  root.replaceChildren(panel);
});

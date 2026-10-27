// ===== Supabase 연결 정보 (공개 키만 넣는다) =====
const SUPABASE_URL = "https://yzoahyduyfzovzsptced.supabase.co";
const SUPABASE_KEY = "sb_publishable_7cVwlalWLIAFKsBm45fXIg_d__r7EqK";

// 이 브라우저가 어떤 카드에 좋아요를 눌렀는지 기억하는 곳
const CLIENT_ID_KEY = "resume_client_id";
const LIKED_KEY = "resume_liked_projects";


// ===== Supabase 부르기 =====
// path 예: "profile?select=*&id=eq.1"
async function supabase(path, options = {}) {
  const response = await fetch(SUPABASE_URL + "/rest/v1/" + path, {
    method: options.method || "GET",
    headers: {
      apikey: SUPABASE_KEY,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (!response.ok) {
    const error = new Error("Supabase 요청 실패: " + response.status);
    error.status = response.status;
    throw error;
  }
  return response;
}


// ===== 작은 도우미 =====
function byId(id) {
  return document.getElementById(id);
}

function makeElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text) element.textContent = text;
  return element;
}

// http/https 주소만 쓴다 (이상한 주소가 들어와도 열지 않도록)
function safeUrl(url) {
  if (!url) return "";
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.href : "";
  } catch {
    return "";
  }
}

// 브라우저 저장소 (사생활 보호 모드에서는 안 될 수 있어서 try로 감싼다)
function readStorage(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function writeStorage(key, value) {
  try { localStorage.setItem(key, value); } catch { /* 저장 못 해도 화면은 동작 */ }
}

// 이 브라우저만의 번호. 처음 한 번 만들어 저장해 둔다.
function getClientId() {
  let id = readStorage(CLIENT_ID_KEY);
  if (!id) {
    id = crypto.randomUUID
      ? crypto.randomUUID()
      : Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
    writeStorage(CLIENT_ID_KEY, id);
  }
  return id;
}

function getLikedIds() {
  try { return JSON.parse(readStorage(LIKED_KEY)) || []; } catch { return []; }
}
function rememberLiked(projectId) {
  const liked = getLikedIds();
  if (!liked.includes(projectId)) liked.push(projectId);
  writeStorage(LIKED_KEY, JSON.stringify(liked));
}


// ===== 1. 프로필 =====
async function loadProfile() {
  const response = await supabase("profile?select=*&id=eq.1");
  const rows = await response.json();
  const profile = rows[0];
  if (!profile) return;

  byId("profile-name").textContent = profile.name;
  byId("profile-title").textContent = profile.title;
  byId("profile-badge").textContent = profile.career_badge;
  byId("contact-name").textContent = profile.name;
  byId("contact-email").textContent = profile.email;
  byId("contact-phone").textContent = profile.phone;
  byId("contact-location").textContent = profile.location;
  byId("profile-intro").textContent = profile.intro;
  byId("profile-education").textContent = profile.education;
  byId("profile-skills").textContent = profile.skills;
  byId("profile-experience").textContent = profile.experience;
  byId("profile-quote").textContent = profile.quote;

  // 사진이 있으면 보여 주고, 없으면 회색 자리 그대로
  const photo = safeUrl(profile.photo_url);
  if (photo) byId("profile-photo").style.backgroundImage = `url("${photo}")`;

  // 한 줄 소개에서 이름 부분에만 파란 밑줄
  const headline = byId("profile-headline");
  headline.textContent = "";
  const at = profile.name ? profile.headline.indexOf(profile.name) : -1;
  if (at === -1) {
    headline.textContent = profile.headline;
  } else {
    headline.append(profile.headline.slice(0, at));
    headline.append(makeElement("mark", "", profile.name));
    headline.append(profile.headline.slice(at + profile.name.length));
  }
}


// ===== 2. 포트폴리오 카드 =====
const HEART_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/></svg>';

// 카드 하나의 좋아요 수 세기 (줄을 다 받지 않고 숫자만 받는다)
async function countLikes(projectId) {
  const response = await supabase(`likes?select=id&project_id=eq.${projectId}`, {
    method: "HEAD",
    headers: { Prefer: "count=exact" },
  });
  // 답장 머리말 예: "0-4/5" 또는 "*/0" → 맨 뒤 숫자가 전체 개수
  const range = response.headers.get("content-range") || "";
  return Number(range.split("/")[1]) || 0;
}

function makeCard(project, likeCount) {
  const card = makeElement("article", "card");

  // 누르면 열 주소: 첨부 파일이 있으면 그것, 없으면 썸네일 이미지
  const openUrl = safeUrl(project.file_url) || safeUrl(project.thumbnail_url);
  let link;
  if (openUrl) {
    link = makeElement("a", "card-link");
    link.href = openUrl;
    link.target = "_blank";
    link.rel = "noopener";
  } else {
    link = makeElement("div", "card-link");
  }

  // 브라우저 창 모양 썸네일
  const browser = makeElement("div", "browser");
  const bar = makeElement("div", "browser-bar");
  bar.append(makeElement("span"), makeElement("span"), makeElement("span"));
  const screen = makeElement("div", "browser-screen");
  const thumb = safeUrl(project.thumbnail_url);
  if (thumb) screen.style.backgroundImage = `url("${thumb}")`;
  browser.append(bar, screen);

  // 글 부분
  const body = makeElement("div", "card-body");
  const meta = [project.number, project.category].filter(Boolean).join(" · ");
  body.append(
    makeElement("p", "card-meta", meta),
    makeElement("h3", "card-title", project.title),
    makeElement("p", "card-desc", project.description)
  );
  if (project.tags && project.tags.length) {
    const tags = makeElement("div", "tags");
    project.tags.forEach((tag) => tags.append(makeElement("span", "tag", tag)));
    body.append(tags);
  }

  link.append(browser, body);

  // 좋아요 버튼 (카드 링크 바깥에 둔다: 하트를 눌러도 새 탭이 열리지 않도록)
  const like = makeElement("button", "like");
  like.type = "button";
  like.innerHTML = HEART_SVG;
  const count = makeElement("span", "", String(likeCount));
  like.append(count);

  const alreadyLiked = getLikedIds().includes(project.id);
  setLikedLook(like, alreadyLiked);
  like.addEventListener("click", () => sendLike(project.id, like, count));

  card.append(link, like);
  return card;
}

function setLikedLook(button, liked) {
  button.classList.toggle("liked", liked);
  button.setAttribute("aria-pressed", liked ? "true" : "false");
  button.setAttribute("aria-label", liked ? "좋아요 누름" : "좋아요");
}

async function sendLike(projectId, button, countElement) {
  if (button.classList.contains("liked") || button.disabled) return;
  button.disabled = true;
  try {
    await supabase("likes", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: { project_id: projectId, client_id: getClientId() },
    });
    countElement.textContent = String(Number(countElement.textContent) + 1);
    rememberLiked(projectId);
    setLikedLook(button, true);
  } catch (error) {
    // 409 = 이 브라우저가 이미 누른 카드 (숫자는 그대로)
    if (error.status === 409) {
      rememberLiked(projectId);
      setLikedLook(button, true);
    } else {
      alert("좋아요를 보내지 못했어요. 잠시 뒤에 다시 눌러 주세요.");
    }
  } finally {
    button.disabled = false;
  }
}

async function loadProjects() {
  const box = byId("cards");
  const response = await supabase("projects?select=*&order=sort_order.asc,id.asc");
  const projects = await response.json();

  if (!projects.length) {
    box.replaceChildren(makeElement("p", "notice", "아직 등록된 프로젝트가 없어요."));
    return;
  }

  const counts = await Promise.all(projects.map((p) => countLikes(p.id).catch(() => 0)));
  box.replaceChildren(...projects.map((p, i) => makeCard(p, counts[i])));
}


// ===== 3. 방명록 =====
function formatDate(value) {
  const date = new Date(value);
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function makeGuestItem(entry) {
  const item = makeElement("li", "guest-item");
  const head = makeElement("div", "guest-head");
  head.append(
    makeElement("span", "guest-nick", entry.nickname),
    makeElement("span", "guest-date", formatDate(entry.created_at))
  );
  item.append(head, makeElement("p", "guest-text", entry.message));
  return item;
}

async function loadGuestbook() {
  const list = byId("guest-list");
  const response = await supabase("resume_guestbook?select=*&order=created_at.desc&limit=100");
  const entries = await response.json();

  if (!entries.length) {
    list.replaceChildren(makeElement("li", "notice", "첫 번째 방명록을 남겨 주세요!"));
    return;
  }
  list.replaceChildren(...entries.map(makeGuestItem));
}

async function sendGuestbook() {
  const nicknameInput = byId("guest-nickname");
  const messageInput = byId("guest-message");
  const status = byId("guest-status");
  const button = byId("guest-submit");

  const nickname = nicknameInput.value.trim();
  const message = messageInput.value.trim();
  if (!nickname || !message) {
    status.textContent = "별명과 한마디를 모두 적어 주세요.";
    return;
  }

  button.disabled = true;
  status.textContent = "";
  try {
    const response = await supabase("resume_guestbook", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: { nickname, message },
    });
    const [saved] = await response.json();

    // 목록 맨 위에 새 글 붙이기
    const list = byId("guest-list");
    list.querySelector(".notice")?.remove();
    list.prepend(makeGuestItem(saved));
    messageInput.value = "";
  } catch {
    status.textContent = "글을 남기지 못했어요. 잠시 뒤에 다시 해 주세요.";
  } finally {
    button.disabled = false;
  }
}

byId("guest-submit").addEventListener("click", sendGuestbook);
// 입력 칸에서 Enter를 눌러도 남기기
["guest-nickname", "guest-message"].forEach((id) => {
  byId(id).addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.isComposing) sendGuestbook();
  });
});


// ===== 시작 =====
loadProfile().catch(() => {
  byId("profile-name").textContent = "프로필을 불러오지 못했어요";
});
loadProjects().catch(() => {
  byId("cards").replaceChildren(makeElement("p", "notice", "프로젝트를 불러오지 못했어요."));
});
loadGuestbook().catch(() => {
  byId("guest-list").replaceChildren(makeElement("li", "notice", "방명록을 불러오지 못했어요."));
});

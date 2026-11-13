chrome.commands.onCommand.addListener(async (command) => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;

  if (command === "create-tab-group") {
    await createNamedGroup(tab);
  } else if (command === "group-by-domain") {
    await groupByDomain(tab);
  }
});

async function createNamedGroup(tab) {
  const groupId = await chrome.tabs.group({ tabIds: [tab.id] });
  const color = await colorForTabs([tab]);
  await chrome.tabGroups.update(groupId, { color });

  const name = await promptInTab(tab.id, "Name this tab group:");
  if (name) {
    await chrome.tabGroups.update(groupId, { title: name });
  }
}

async function groupByDomain(tab) {
  const domain = hostnameOf(tab.url);
  if (!domain) return;

  const tabsInWindow = await chrome.tabs.query({ currentWindow: true });
  const matching = tabsInWindow.filter((t) => hostnameOf(t.url) === domain);
  if (matching.length === 0) return;

  const groupId = await chrome.tabs.group({
    tabIds: matching.map((t) => t.id),
  });
  const color = await colorForTabs(matching);
  await chrome.tabGroups.update(groupId, { title: labelForDomain(domain), color });
}

function hostnameOf(url) {
  try {
    return new URL(url).hostname || null;
  } catch {
    return null;
  }
}

// "github.com" -> "github", "mail.google.com" -> "google"
function labelForDomain(hostname) {
  const parts = hostname.replace(/^www\./, "").split(".");
  const label = parts.length >= 2 ? parts[parts.length - 2] : parts[0];
  return label;
}

async function promptInTab(tabId, message) {
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
      func: (msg) => window.prompt(msg),
      args: [message],
    });
    return result;
  } catch {
    // Can't inject into restricted pages (chrome://, the Web Store, PDF viewer, etc.)
    return null;
  }
}

// --- Color: default to grey, upgrade to a palette color if favicons agree on one ---

const GROUP_COLORS = [
  "grey",
  "blue",
  "red",
  "yellow",
  "green",
  "pink",
  "purple",
  "cyan",
  "orange",
];

async function colorForTabs(tabs) {
  try {
    const samples = [];
    for (const t of tabs) {
      if (!t.favIconUrl) continue;
      const rgb = await averageColorForFavicon(t.favIconUrl);
      if (rgb) samples.push(rgb);
    }
    if (samples.length === 0) return "grey";
    const avg = samples
      .reduce((acc, c) => [acc[0] + c[0], acc[1] + c[1], acc[2] + c[2]], [0, 0, 0])
      .map((v) => v / samples.length);
    return mapRgbToGroupColor(avg) ?? "grey";
  } catch {
    return "grey";
  }
}

async function averageColorForFavicon(url) {
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    const bitmap = await createImageBitmap(blob);
    const size = 16;
    const canvas = new OffscreenCanvas(size, size);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(bitmap, 0, 0, size, size);
    const { data } = ctx.getImageData(0, 0, size, size);

    let r = 0, g = 0, b = 0, count = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 32) continue; // skip near-transparent pixels
      r += data[i];
      g += data[i + 1];
      b += data[i + 2];
      count++;
    }
    if (count === 0) return null;
    return [r / count, g / count, b / count];
  } catch {
    return null;
  }
}

function mapRgbToGroupColor([r, g, b]) {
  const { h, s, l } = rgbToHsl(r, g, b);
  // Grayscale, near-black, or near-white favicons don't carry a usable hue.
  if (s < 0.18 || l < 0.12 || l > 0.92) return null;

  if (h < 15 || h >= 345) return "red";
  if (h < 45) return "orange";
  if (h < 70) return "yellow";
  if (h < 160) return "green";
  if (h < 200) return "cyan";
  if (h < 255) return "blue";
  if (h < 290) return "purple";
  return "pink";
}

function rgbToHsl(r, g, b) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      case b:
        h = (r - g) / d + 4;
        break;
    }
    h *= 60;
  }
  return { h, s, l };
}

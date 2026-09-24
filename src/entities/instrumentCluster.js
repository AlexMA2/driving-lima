import * as THREE from 'three';

// The instrument cluster behind the steering wheel: a tachometer, a speedometer and a
// multi-info display between them (digital speed, turn-signal arrows, gear, warning lamps),
// painted on a canvas that is used as a texture on a plane in the cockpit. The dial faces are
// drawn once; every update only repaints the needles/readouts, and only when something changed.

const W = 1024, H = 320;
export const CLUSTER_SIZE = { w: 0.62, h: 0.194 };

const TACH = { cx: 205, cy: 168, r: 146, max: 8, redFrom: 6.5 };
const SPEEDO = { cx: 819, cy: 168, r: 146, max: 200 };
const SWEEP_FROM = Math.PI * 0.75; // 135°, canvas angles run clockwise from +x
const SWEEP = Math.PI * 1.5;       // 270° of travel

const IDLE_RPM = 850;
// rpm per km/h in each forward gear, and the shift points that pick between them
const GEAR_RATIO = [0, 112, 66, 46, 35, 28];
const UPSHIFT_RPM = 3300;
const DOWNSHIFT_RPM = 1450;
const REVERSE_RATIO = 105;

const FONT = '"Segoe UI", "Helvetica Neue", Arial, sans-serif';
const angleOf = (dial, value) => SWEEP_FROM + Math.min(Math.max(value / dial.max, 0), 1) * SWEEP;

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function drawDialFace(ctx, dial, { unit, labelStep, minorStep, labelScale = 1, redFrom }) {
  const { cx, cy, r } = dial;
  // bezel: brushed-metal ring around a dark face
  const ring = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
  ring.addColorStop(0, '#e8ebef'); ring.addColorStop(0.45, '#7d848d'); ring.addColorStop(1, '#c9ced4');
  ctx.beginPath(); ctx.arc(cx, cy, r + 6, 0, Math.PI * 2); ctx.fillStyle = ring; ctx.fill();
  const face = ctx.createRadialGradient(cx, cy - r * 0.25, r * 0.1, cx, cy, r);
  face.addColorStop(0, '#20252d'); face.addColorStop(1, '#07090c');
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fillStyle = face; ctx.fill();

  // redline band
  if (redFrom !== undefined) {
    ctx.beginPath();
    ctx.arc(cx, cy, r - 12, angleOf(dial, redFrom), angleOf(dial, dial.max));
    ctx.lineWidth = 9; ctx.strokeStyle = '#d62828'; ctx.stroke();
  }

  // ticks and numbers
  for (let v = 0; v <= dial.max + 1e-6; v += minorStep) {
    const major = Math.abs(v / labelStep - Math.round(v / labelStep)) < 1e-6;
    const a = angleOf(dial, v);
    const r1 = r - 8, r2 = r - (major ? 30 : 20);
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
    ctx.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2);
    ctx.lineWidth = major ? 4 : 2;
    ctx.strokeStyle = redFrom !== undefined && v >= redFrom ? '#ff6b6b' : '#f2f4f7';
    ctx.stroke();
    if (major) {
      ctx.font = `700 ${Math.round(30 * labelScale)}px ${FONT}`;
      ctx.fillStyle = '#f2f4f7'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(String(Math.round(v)), cx + Math.cos(a) * (r - 55), cy + Math.sin(a) * (r - 55));
    }
  }
  ctx.font = `600 22px ${FONT}`; ctx.fillStyle = '#9aa3ad'; ctx.textAlign = 'center';
  ctx.fillText(unit, cx, cy + 46);
}

// A small horizontal bar gauge ("C … H", "E … F") with a fixed reading.
function drawMiniBar(ctx, x, y, w, leftLabel, rightLabel, level, color) {
  ctx.font = `700 17px ${FONT}`; ctx.fillStyle = '#9aa3ad'; ctx.textBaseline = 'middle';
  ctx.textAlign = 'right'; ctx.fillText(leftLabel, x - 8, y);
  ctx.textAlign = 'left'; ctx.fillText(rightLabel, x + w + 8, y);
  ctx.fillStyle = '#252a31'; ctx.fillRect(x, y - 5, w, 10);
  ctx.fillStyle = color; ctx.fillRect(x, y - 5, w * level, 10);
  for (let i = 0; i <= 4; i++) { ctx.fillStyle = '#07090c'; ctx.fillRect(x + (w / 4) * i - 1, y - 8, 2, 16); }
}

function buildBackground() {
  const c = makeCanvas(W, H);
  const ctx = c.getContext('2d');
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#0b0d11'); bg.addColorStop(1, '#14171d');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

  drawDialFace(ctx, TACH, { unit: 'x1000 rpm', labelStep: 1, minorStep: 0.5, redFrom: TACH.redFrom });
  drawDialFace(ctx, SPEEDO, { unit: 'km/h', labelStep: 20, minorStep: 10, labelScale: 0.86 });
  drawMiniBar(ctx, TACH.cx - 45, TACH.cy + 84, 90, 'C', 'H', 0.5, '#4fc3f7');
  drawMiniBar(ctx, SPEEDO.cx - 45, SPEEDO.cy + 84, 90, 'E', 'F', 0.72, '#ffb300');

  // centre display panel
  ctx.fillStyle = '#0a0c10';
  ctx.beginPath(); ctx.roundRect(366, 14, 292, 292, 22); ctx.fill();
  ctx.lineWidth = 3; ctx.strokeStyle = '#2a2f37'; ctx.stroke();
  return c;
}

function needle(ctx, dial, value, color) {
  const a = angleOf(dial, value);
  ctx.save();
  ctx.translate(dial.cx, dial.cy);
  ctx.rotate(a);
  ctx.shadowColor = color; ctx.shadowBlur = 12;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(-26, -5); ctx.lineTo(dial.r - 22, -1.5); ctx.lineTo(dial.r - 22, 1.5); ctx.lineTo(-26, 5);
  ctx.closePath(); ctx.fill();
  ctx.restore();
  const hub = ctx.createRadialGradient(dial.cx - 3, dial.cy - 3, 1, dial.cx, dial.cy, 15);
  hub.addColorStop(0, '#f5f6f8'); hub.addColorStop(1, '#575d66');
  ctx.beginPath(); ctx.arc(dial.cx, dial.cy, 14, 0, Math.PI * 2); ctx.fillStyle = hub; ctx.fill();
}

// Left-pointing turn arrow ~64 wide, mirrored by `dir`.
function turnArrow(ctx, cx, cy, dir, lit) {
  ctx.save();
  ctx.translate(cx, cy); ctx.scale(dir, 1);
  ctx.shadowColor = '#3cff6b'; ctx.shadowBlur = lit ? 18 : 0;
  ctx.fillStyle = lit ? '#3cff6b' : '#1c2a20';
  ctx.beginPath();
  ctx.moveTo(-34, 0); ctx.lineTo(-8, -26); ctx.lineTo(-8, -11); ctx.lineTo(34, -11);
  ctx.lineTo(34, 11); ctx.lineTo(-8, 11); ctx.lineTo(-8, 26);
  ctx.closePath(); ctx.fill();
  ctx.restore();
}

function lamp(ctx, x, y, lit, color, draw) {
  ctx.save();
  ctx.translate(x, y);
  ctx.lineWidth = 4; ctx.lineCap = 'round';
  ctx.strokeStyle = lit ? color : '#252a31';
  ctx.fillStyle = lit ? color : '#252a31';
  ctx.shadowColor = color; ctx.shadowBlur = lit ? 12 : 0;
  draw(ctx);
  ctx.restore();
}

const drawHandbrake = (ctx) => {
  ctx.beginPath(); ctx.arc(0, 0, 17, 0, Math.PI * 2); ctx.stroke();
  ctx.font = `800 22px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('P', 0, 1);
  ctx.beginPath(); ctx.arc(0, 0, 25, Math.PI * 0.75, Math.PI * 1.25); ctx.stroke();
  ctx.beginPath(); ctx.arc(0, 0, 25, -Math.PI * 0.25, Math.PI * 0.25); ctx.stroke();
};
const drawSeatbelt = (ctx) => {
  ctx.beginPath(); ctx.arc(0, -12, 6, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.moveTo(-8, -2); ctx.lineTo(8, -2); ctx.lineTo(8, 16); ctx.lineTo(-8, 16); ctx.closePath(); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-8, -2); ctx.lineTo(8, 16); ctx.stroke();
};
const drawEngine = (ctx) => {
  ctx.beginPath(); ctx.moveTo(-18, -8); ctx.lineTo(-8, -8); ctx.lineTo(-4, -14); ctx.lineTo(10, -14);
  ctx.lineTo(10, -8); ctx.lineTo(18, -8); ctx.lineTo(18, 12); ctx.lineTo(-18, 12); ctx.closePath(); ctx.stroke();
};
const drawLowBeam = (ctx) => {
  ctx.beginPath(); ctx.arc(2, 0, 13, -Math.PI * 0.5, Math.PI * 0.5, true); ctx.closePath(); ctx.stroke();
  for (let i = -1; i <= 1; i++) { ctx.beginPath(); ctx.moveTo(-6, i * 9); ctx.lineTo(-22, i * 9 + 3); ctx.stroke(); }
};

export function createCluster() {
  const bg = buildBackground();
  const canvas = makeCanvas(W, H);
  const ctx = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;

  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(CLUSTER_SIZE.w, CLUSTER_SIZE.h),
    new THREE.MeshBasicMaterial({ map: texture, toneMapped: false })
  );

  let gear = 1;             // automatic gearbox state (1..5 forward)
  let rpm = IDLE_RPM;
  let odometer = 48213.4;   // km
  let needleSpeed = 0, needleRpm = IDLE_RPM;
  let lastKey = '';

  // data: { dt, speedKmh, forwardMs, throttle, brakeHeld, handbrake, wrecked, signalLeft, signalRight, blink }
  function update(d) {
    const dt = Math.min(d.dt || 0.016, 0.1);
    odometer += (d.speedKmh / 3600) * dt;

    const reversing = d.forwardMs < -0.25 || (d.brakeHeld && d.speedKmh < 3 && d.throttle <= 0 && !d.wrecked);
    const moving = d.speedKmh > 1;
    let targetRpm;
    if (d.wrecked) targetRpm = 0;
    else if (reversing) targetRpm = Math.max(IDLE_RPM, d.speedKmh * REVERSE_RATIO) + d.throttle * 300;
    else {
      // pick the gear by the rpm it would give, with hysteresis between shift points
      while (gear < 5 && d.speedKmh * GEAR_RATIO[gear] > UPSHIFT_RPM) gear++;
      while (gear > 1 && d.speedKmh * GEAR_RATIO[gear] < DOWNSHIFT_RPM) gear--;
      targetRpm = Math.max(IDLE_RPM, d.speedKmh * GEAR_RATIO[gear]) + d.throttle * 700;
    }
    // the needles have a little inertia, like a real stepper-driven gauge
    const k = 1 - Math.exp(-9 * dt);
    needleRpm += (targetRpm - needleRpm) * k;
    needleSpeed += (d.speedKmh - needleSpeed) * (1 - Math.exp(-14 * dt));

    const shownGear = d.wrecked ? 'P' : d.handbrake && !moving ? 'P' : reversing ? 'R' : 'D';
    const arrowL = d.signalLeft && d.blink, arrowR = d.signalRight && d.blink;
    const key = [Math.round(needleSpeed * 2), Math.round(needleRpm / 25), Math.round(d.speedKmh), shownGear, arrowL, arrowR,
      d.handbrake, d.wrecked, Math.floor(odometer)].join('|');
    if (key === lastKey) return;
    lastKey = key;

    ctx.drawImage(bg, 0, 0);
    needle(ctx, TACH, needleRpm / 1000, '#ff7a2f');
    needle(ctx, SPEEDO, needleSpeed, '#ff7a2f');

    // centre display: turn arrows, digital speed, gear selector, odometer, warning lamps
    turnArrow(ctx, 425, 62, 1, arrowL);
    turnArrow(ctx, 599, 62, -1, arrowR);

    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.font = `800 118px ${FONT}`; ctx.fillStyle = '#ffffff';
    ctx.shadowColor = 'rgba(120,200,255,0.55)'; ctx.shadowBlur = 14;
    ctx.fillText(String(Math.round(d.speedKmh)), 512, 178);
    ctx.shadowBlur = 0;
    ctx.font = `600 26px ${FONT}`; ctx.fillStyle = '#9aa3ad';
    ctx.fillText('km/h', 512, 208);

    ctx.font = `800 30px ${FONT}`; ctx.textBaseline = 'middle';
    ['P', 'R', 'N', 'D'].forEach((g, i) => {
      const x = 440 + i * 48;
      const on = g === shownGear;
      ctx.fillStyle = on ? (g === 'R' ? '#ff5252' : '#3cff6b') : '#3a414b';
      ctx.fillText(g, x, 240);
    });
    ctx.font = `600 22px ${FONT}`; ctx.fillStyle = '#c3c9d1';
    ctx.fillText(`${Math.floor(odometer).toLocaleString('en-US').replace(/,/g, ' ')} km`, 512, 274);

    lamp(ctx, 400, 292, d.handbrake || d.wrecked, '#ff3b30', drawHandbrake);
    lamp(ctx, 462, 292, false, '#ff3b30', drawSeatbelt);
    lamp(ctx, 562, 292, d.wrecked, '#ffb300', drawEngine);
    lamp(ctx, 624, 292, !d.wrecked, '#3cff6b', drawLowBeam);

    texture.needsUpdate = true;
  }

  update({ dt: 0.016, speedKmh: 0, forwardMs: 0, throttle: 0, brakeHeld: false, handbrake: false, wrecked: false, signalLeft: false, signalRight: false, blink: false });
  return { mesh, update };
}

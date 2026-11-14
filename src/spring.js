// Critically-tuned spring, modelled on SwiftUI's .spring(response:dampingFraction:)
class Spring {
  constructor(value, { response = 0.42, damping = 0.78 } = {}) {
    this.value = value;
    this.target = value;
    this.velocity = 0;
    this.set(response, damping);
  }
  set(response, damping) {
    this.k = Math.pow((2 * Math.PI) / response, 2); // stiffness (mass = 1)
    this.c = (4 * Math.PI * damping) / response;    // damping coefficient
  }
  step(dt) {
    const f = -this.k * (this.value - this.target) - this.c * this.velocity;
    this.velocity += f * dt;
    this.value += this.velocity * dt;
  }
  get resting() {
    return Math.abs(this.value - this.target) < 0.05 && Math.abs(this.velocity) < 0.05;
  }
}

// Animates a group of named springs with a single rAF loop.
class SpringGroup {
  constructor(initial, onFrame) {
    this.springs = {};
    for (const [k, v] of Object.entries(initial)) this.springs[k] = new Spring(v);
    this.onFrame = onFrame;
    this.running = false;
    this.last = 0;
  }
  to(targets, { response = 0.42, damping = 0.78 } = {}) {
    for (const [k, v] of Object.entries(targets)) {
      const s = this.springs[k];
      if (!s) continue;
      s.set(response, damping);
      s.target = v;
    }
    this.kick();
  }
  kick() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    requestAnimationFrame(this.tick.bind(this));
  }
  tick(now) {
    let dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    // fixed sub-steps keep stiff springs stable
    const sub = Math.max(1, Math.ceil(dt / (1 / 240)));
    const h = dt / sub;
    let resting = true;
    for (const s of Object.values(this.springs)) {
      for (let i = 0; i < sub; i++) s.step(h);
      if (!s.resting) resting = false;
    }
    const vals = {};
    for (const [k, s] of Object.entries(this.springs)) {
      if (resting) { s.value = s.target; s.velocity = 0; }
      vals[k] = s.value;
    }
    this.onFrame(vals);
    if (resting) { this.running = false; return; }
    requestAnimationFrame(this.tick.bind(this));
  }
  get(k) { return this.springs[k].value; }
}
window.Spring = Spring;
window.SpringGroup = SpringGroup;

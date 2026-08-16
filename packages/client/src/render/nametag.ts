import * as THREE from 'three';

/** Canvas-text sprite that always faces the camera. */
export function createNametag(text: string): { sprite: THREE.Sprite; dispose(): void } {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  ctx.font = 'bold 34px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  const w = Math.min(250, ctx.measureText(text).width + 24);
  ctx.fillRect(128 - w / 2, 8, w, 48);
  ctx.fillStyle = '#fff';
  ctx.fillText(text, 128, 32);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(1.6, 0.4, 1);
  sprite.position.set(0, 2.15, 0);
  return {
    sprite,
    dispose() {
      texture.dispose();
      material.dispose();
    },
  };
}

import * as THREE from 'three';

export type CornerName = 'a1' | 'h1' | 'h8' | 'a8';

/** Output of tools/solve_camera.py (public/assets/scene/palace_garden_camera.json). */
export interface CameraData {
  image_size: [number, number];
  focal_px: number;
  principal_point_px: [number, number];
  position: [number, number, number];
  quaternion: [number, number, number, number];
  image_corners: Record<CornerName, [number, number]>;
}

/** Region of the backdrop image that fills the canvas, in image pixels (y down). */
export interface ViewRect { x: number; y: number; w: number; h: number }

/**
 * Fixed camera that reproduces the painted backdrop's perspective exactly: an asymmetric
 * frustum built from the solved focal length and off-centre principal point. Duel punch-ins
 * shrink `viewRect`; the image plates are cropped with the same rectangle so everything stays aligned.
 */
export class MatchedCamera extends THREE.PerspectiveCamera {
  data!: CameraData;
  viewRect!: ViewRect;

  constructor(data: CameraData) {
    const [w, h] = data.image_size;
    super(25, w / h, 0.5, 120);
    this.data = data;
    this.viewRect = { x: 0, y: 0, w, h };
    this.position.fromArray(data.position);
    this.quaternion.fromArray(data.quaternion);
    this.updateProjectionMatrix();
    this.updateMatrixWorld(true);
  }

  /** Switches to another arena's solved camera (same image size). */
  setData(data: CameraData): void {
    this.data = data;
    this.position.fromArray(data.position);
    this.quaternion.fromArray(data.quaternion);
    this.updateMatrixWorld(true);
    this.homeView = null;
    this.resetView();
  }

  get imageWidth(): number { return this.data.image_size[0]; }
  get imageHeight(): number { return this.data.image_size[1]; }

  override updateProjectionMatrix(): void {
    if (!this.data) { super.updateProjectionMatrix(); return; } // called by the base constructor
    const f = this.data.focal_px;
    const [cx, cy] = this.data.principal_point_px;
    const n = this.near;
    const v = this.viewRect;
    this.projectionMatrix.makePerspective(
      ((v.x - cx) * n) / f,
      ((v.x + v.w - cx) * n) / f,
      ((cy - v.y) * n) / f,
      ((cy - v.y - v.h) * n) / f,
      n,
      this.far,
    );
    this.projectionMatrixInverse.copy(this.projectionMatrix).invert();
  }

  setView(rect: ViewRect): void {
    this.viewRect = { ...rect };
    this.updateProjectionMatrix();
  }

  /** The resting view (whole image on menus; board close-up during a game). */
  homeView: ViewRect | null = null;

  resetView(): void {
    this.setView(this.homeView ?? { x: 0, y: 0, w: this.imageWidth, h: this.imageHeight });
  }

  /** Projects a world point to full-image pixel coordinates (y down), independent of the view. */
  toImagePx(p: THREE.Vector3): [number, number] {
    const v = p.clone().applyMatrix4(this.matrixWorldInverse);
    const f = this.data.focal_px;
    const [cx, cy] = this.data.principal_point_px;
    return [cx + (f * v.x) / -v.z, cy - (f * v.y) / -v.z];
  }
}

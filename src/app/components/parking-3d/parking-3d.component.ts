import { Component, ElementRef, ViewChild, AfterViewInit, NgZone, OnDestroy, HostListener } from '@angular/core';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

@Component({
  selector: 'app-parking-3d',
  standalone: true,
  template: `<div class="canvas-container"><canvas #canvas></canvas></div>`,
  styles: [`
    .canvas-container { width: 100%; height: 100%; overflow: hidden; background: #EBF0F5; }
    canvas { display: block; width: 100%; height: 100%; outline: none; }
  `]
})
export class Parking3DComponent implements AfterViewInit, OnDestroy {
  @ViewChild('canvas') private canvasRef!: ElementRef<HTMLCanvasElement>;

  private scene!: THREE.Scene;
  private camera!: THREE.OrthographicCamera;
  private renderer!: THREE.WebGLRenderer;
  private controls!: OrbitControls;
  private frameId: number | null = null;
  private readonly frustumSize = 80;

  constructor(private ngZone: NgZone) {}

  ngAfterViewInit(): void {
    this.initScene();
    this.buildParkingLot();
    this.startAnimationLoop();
    setTimeout(() => this.onWindowResize(), 100);
  }

  ngOnDestroy(): void {
    if (this.frameId) cancelAnimationFrame(this.frameId);
    if (this.renderer) {
      this.renderer.dispose();
      this.renderer.forceContextLoss();
    }
    if (this.controls) this.controls.dispose();
  }

  @HostListener('window:resize')
  onWindowResize(): void {
    if (!this.camera || !this.renderer) return;

    const canvas = this.canvasRef.nativeElement;
    const container = canvas.parentElement;
    if (!container) return;

    const aspect = container.clientWidth / container.clientHeight;

    this.camera.left = -this.frustumSize * aspect / 2;
    this.camera.right = this.frustumSize * aspect / 2;
    this.camera.top = this.frustumSize / 2;
    this.camera.bottom = -this.frustumSize / 2;
    this.camera.updateProjectionMatrix();

    this.renderer.setSize(container.clientWidth, container.clientHeight);
  }

  private initScene(): void {
    const canvas = this.canvasRef.nativeElement;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xEBF0F5);

    const aspect = canvas.clientWidth / canvas.clientHeight || 1;
    this.camera = new THREE.OrthographicCamera(
      this.frustumSize * aspect / -2, this.frustumSize * aspect / 2,
      this.frustumSize / 2, this.frustumSize / -2, 
      0.1, 1000
    );
    this.camera.position.set(40, 40, 40);
    this.camera.lookAt(0, 0, 0);

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setSize(canvas.clientWidth, canvas.clientHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.target.set(0, 0, 0);
    this.controls.maxPolarAngle = Math.PI / 2 - 0.05; // Prevent going below ground

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    this.scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(-20, 40, 20);
    dirLight.castShadow = true;
    dirLight.shadow.camera.left = -40;
    dirLight.shadow.camera.right = 40;
    dirLight.shadow.camera.top = 40;
    dirLight.shadow.camera.bottom = -40;
    dirLight.shadow.mapSize.width = 2048;
    dirLight.shadow.mapSize.height = 2048;
    this.scene.add(dirLight);
  }

  private createEntranceBarrier(x: number, z: number, rotation: number = 0): void {
    const entranceGroup = new THREE.Group();
    entranceGroup.position.set(x, 0, z);
    entranceGroup.rotation.y = rotation;

    const boothGeo = new THREE.BoxGeometry(2, 3, 2);
    const boothMat = new THREE.MeshStandardMaterial({ color: 0x2c3e50, roughness: 0.5 });
    const booth = new THREE.Mesh(boothGeo, boothMat);
    booth.position.set(0, 1.5, 0);
    booth.castShadow = true;
    entranceGroup.add(booth);

    const glassGeo = new THREE.BoxGeometry(2.05, 1, 1.5);
    const glassMat = new THREE.MeshStandardMaterial({ color: 0x87ceeb, metalness: 0.9, roughness: 0.1 });
    const glass = new THREE.Mesh(glassGeo, glassMat);
    glass.position.set(0, 1.8, 0.2); 
    entranceGroup.add(glass);

    const baseGeo = new THREE.BoxGeometry(0.5, 1, 0.5);
    const baseMat = new THREE.MeshStandardMaterial({ color: 0xe67e22 });
    const base = new THREE.Mesh(baseGeo, baseMat);
    base.position.set(-2, 0.5, 1);
    base.castShadow = true;
    entranceGroup.add(base);

    const armGeo = new THREE.BoxGeometry(5, 0.15, 0.15);
    const armMat = new THREE.MeshStandardMaterial({ color: 0xe74c3c });
    const arm = new THREE.Mesh(armGeo, armMat);
    arm.position.set(-4, 0.9, 1);
    arm.rotation.z = Math.PI / 12;
    arm.castShadow = true;
    entranceGroup.add(arm);

    this.scene.add(entranceGroup);
  }

  private createLightPole(x: number, z: number): void {
    const poleGroup = new THREE.Group();
    poleGroup.position.set(x, 0, z);

    const poleGeo = new THREE.CylinderGeometry(0.1, 0.15, 8);
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x95a5a6, metalness: 0.8, roughness: 0.2 });
    const pole = new THREE.Mesh(poleGeo, poleMat);
    pole.position.y = 4;
    pole.castShadow = true;
    poleGroup.add(pole);

    const armGeo = new THREE.CylinderGeometry(0.05, 0.05, 2);
    const arm = new THREE.Mesh(armGeo, poleMat);
    arm.position.set(0.8, 7.8, 0);
    arm.rotation.z = Math.PI / 2;
    arm.castShadow = true;
    poleGroup.add(arm);

    const lampGeo = new THREE.BoxGeometry(0.6, 0.15, 0.5);
    const lampMat = new THREE.MeshStandardMaterial({ color: 0xecf0f1 });
    const lamp = new THREE.Mesh(lampGeo, lampMat);
    lamp.position.set(1.6, 7.8, 0);
    poleGroup.add(lamp);

    const bulbGeo = new THREE.PlaneGeometry(0.5, 0.4);
    const bulbMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const bulb = new THREE.Mesh(bulbGeo, bulbMat);
    bulb.rotation.x = Math.PI / 2;
    bulb.position.set(1.6, 7.72, 0);
    poleGroup.add(bulb);

    const spotLight = new THREE.SpotLight(0xfff5b6, 2.0);
    spotLight.position.set(1.6, 7.7, 0);
    spotLight.angle = Math.PI / 3;
    spotLight.penumbra = 0.5;
    spotLight.castShadow = false; // Disable to save WebGL texture units
    spotLight.distance = 40;
    
    const targetObj = new THREE.Object3D();
    targetObj.position.set(1.6, 0, 0);
    poleGroup.add(targetObj);
    spotLight.target = targetObj;
    poleGroup.add(spotLight);

    this.scene.add(poleGroup);
  }

  private createTrafficCone(x: number, z: number): void {
    const coneGroup = new THREE.Group();
    coneGroup.position.set(x, 0, z);

    const baseGeo = new THREE.BoxGeometry(0.4, 0.05, 0.4);
    const baseMat = new THREE.MeshStandardMaterial({ color: 0xd35400 });
    const base = new THREE.Mesh(baseGeo, baseMat);
    base.position.y = 0.025;
    coneGroup.add(base);

    const coneGeo = new THREE.ConeGeometry(0.15, 0.6, 16);
    const coneMat = new THREE.MeshStandardMaterial({ color: 0xe67e22, roughness: 0.7 });
    const cone = new THREE.Mesh(coneGeo, coneMat);
    cone.position.y = 0.35;
    cone.castShadow = true;
    coneGroup.add(cone);

    const stripeGeo = new THREE.CylinderGeometry(0.1, 0.12, 0.15, 16);
    const stripeMat = new THREE.MeshStandardMaterial({ color: 0xffffff });
    const stripe = new THREE.Mesh(stripeGeo, stripeMat);
    stripe.position.y = 0.4;
    coneGroup.add(stripe);

    this.scene.add(coneGroup);
  }

  private createFence(x: number, z: number, length: number, isVertical: boolean = false): void {
    const fenceGeo = new THREE.BoxGeometry(length, 0.8, 0.4);
    const fenceMat = new THREE.MeshStandardMaterial({ color: 0x34495e, roughness: 0.9 });
    const fence = new THREE.Mesh(fenceGeo, fenceMat);
    
    fence.position.set(x, 0.4, z);
    if (isVertical) fence.rotation.y = Math.PI / 2;
    fence.castShadow = true;
    fence.receiveShadow = true;
    
    this.scene.add(fence);
  }

  private createBush(x: number, z: number): void {
    const bushGeo = new THREE.DodecahedronGeometry(0.8 + Math.random() * 0.4, 1);
    const bushMat = new THREE.MeshStandardMaterial({ color: 0x27ae60, roughness: 0.9 });
    const bush = new THREE.Mesh(bushGeo, bushMat);
    bush.position.set(x, 0.5, z);
    bush.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, 0);
    bush.castShadow = true;
    
    this.scene.add(bush);
  }

  private createParkingSlot(x: number, z: number, width: number, depth: number, isFree: boolean, rotation: number = 0): void {
    const slotGroup = new THREE.Group();
    slotGroup.position.set(x, 0.01, z);
    slotGroup.rotation.y = rotation;

    const lineGeoLen = new THREE.BoxGeometry(0.1, 0.02, depth);
    const lineGeoWid = new THREE.BoxGeometry(width, 0.02, 0.1);
    const lineMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
    
    const leftLine = new THREE.Mesh(lineGeoLen, lineMaterial);
    leftLine.position.set(-width / 2, 0, 0);
    slotGroup.add(leftLine);

    const rightLine = new THREE.Mesh(lineGeoLen, lineMaterial);
    rightLine.position.set(width / 2, 0, 0);
    slotGroup.add(rightLine);

    const backLine = new THREE.Mesh(lineGeoWid, lineMaterial);
    backLine.position.set(0, 0, -depth / 2);
    slotGroup.add(backLine);

    const indicatorColor = isFree ? 0x2ecc71 : 0xe74c3c;
    const indicatorGeo = new THREE.BoxGeometry(1, 0.1, 0.5);
    const indicatorMat = new THREE.MeshStandardMaterial({ 
      color: indicatorColor, 
      emissive: indicatorColor, 
      emissiveIntensity: 0.8 
    });
    const indicator = new THREE.Mesh(indicatorGeo, indicatorMat);
    indicator.position.set(0, 0.05, -depth / 2 + 0.5);
    slotGroup.add(indicator);

    if (!isFree) {
      const carGroup = new THREE.Group();
      
      const carGeo = new THREE.BoxGeometry(1.8, 1.0, 4.2);
      const colors = [0xffffff, 0x333333, 0xaaaaaa, 0x8b0000, 0x00008b, 0x2ecc71, 0xf1c40f];
      const randomColor = colors[Math.floor(Math.random() * colors.length)];
      const carMat = new THREE.MeshStandardMaterial({ color: randomColor, roughness: 0.3, metalness: 0.2 }); 
      const carBody = new THREE.Mesh(carGeo, carMat);
      carBody.position.set(0, 0.7, 0);
      carBody.castShadow = true;
      carBody.receiveShadow = true;
      carGroup.add(carBody);

      const glassGeo = new THREE.BoxGeometry(1.82, 0.5, 2.5);
      const glassMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.1, metalness: 0.8 });
      const glass = new THREE.Mesh(glassGeo, glassMat);
      glass.position.set(0, 1.1, -0.2);
      carGroup.add(glass);

      // Add tail lights
      const tailLightGeo = new THREE.BoxGeometry(0.4, 0.2, 0.1);
      const tailLightMat = new THREE.MeshStandardMaterial({ color: 0xff0000, emissive: 0xff0000, emissiveIntensity: 0.5 });
      const leftTail = new THREE.Mesh(tailLightGeo, tailLightMat);
      leftTail.position.set(-0.6, 0.7, -2.1);
      carGroup.add(leftTail);
      
      const rightTail = new THREE.Mesh(tailLightGeo, tailLightMat);
      rightTail.position.set(0.6, 0.7, -2.1);
      carGroup.add(rightTail);

      slotGroup.add(carGroup);
    }

    this.scene.add(slotGroup);
  }

  private buildParkingLot(): void {
    // Make ground larger (60x60)
    const groundGeo = new THREE.BoxGeometry(60, 0.5, 60);
    const groundMat = new THREE.MeshStandardMaterial({ color: 0x4a4a4a, roughness: 0.8 }); 
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.position.y = -0.25;
    ground.receiveShadow = true;
    this.scene.add(ground);

    // Outer Fences
    this.createFence(0, -29.8, 60); // top
    this.createFence(0, 29.8, 60);  // bottom
    this.createFence(-29.8, 0, 60, true); // left
    this.createFence(29.8, -18, 24, true); // right top
    this.createFence(29.8, 18, 24, true); // right bottom

    // Entrance on the right side
    this.createEntranceBarrier(27, 0, 0); 
    
    // Road cones at entrance
    this.createTrafficCone(25, 4);
    this.createTrafficCone(25, -4);
    this.createTrafficCone(28, 4);
    this.createTrafficCone(28, -4);

    // Light poles spread around
    this.createLightPole(-25, -25);
    this.createLightPole(-25, 0);
    this.createLightPole(-25, 25);
    this.createLightPole(0, -25);
    this.createLightPole(0, 25);
    this.createLightPole(25, -25);
    this.createLightPole(25, 25);

    // Add Bushes
    for (let i = 0; i < 15; i++) {
      this.createBush(-27 + Math.random() * 54, -27);
      this.createBush(-27, -27 + Math.random() * 54);
    }

    // Parking Layout Configuration
    const slotWidth = 3.2;
    const slotDepth = 5.5;
    const cols = 10;
    
    // We will have 5 rows of 10 cars = 50 cars total
    // Layout: 
    // Row 0 (Top facing down)
    // --- Driving Lane ---
    // Row 1 (Facing up)
    // Row 2 (Facing down)
    // --- Driving Lane ---
    // Row 3 (Facing up)
    // Row 4 (Facing down)
    // --- Driving Lane ---
    // Wait, let's just make them simple parallel rows with aisles
    
    const startX = -18;
    
    // Row configurations [zPos, rotation]
    const rowConfigs = [
      [-20, 0],              // Row 0
      [-9, Math.PI],         // Row 1 (faces Row 0, sharing aisle at z=-14.5)
      [-1, 0],               // Row 2 
      [10, Math.PI],         // Row 3 (faces Row 2, sharing aisle at z=4.5)
      [18, 0]                // Row 4 (sharing aisle at z=23.5 with empty space or bottom)
    ];

    for (let row = 0; row < rowConfigs.length; row++) {
      for (let col = 0; col < cols; col++) {
        const xPos = startX + (col * slotWidth);
        const zPos = rowConfigs[row][0];
        const rotation = rowConfigs[row][1];
        
        // Make some random spots taken
        const isFree = Math.random() > 0.4; // 60% free spots
        this.createParkingSlot(xPos, zPos, slotWidth, slotDepth, isFree, rotation);
      }
    }

    // Add road markings (yellow center line for entrance)
    const roadLineGeo = new THREE.BoxGeometry(10, 0.02, 0.3);
    const roadLineMat = new THREE.MeshBasicMaterial({ color: 0xf1c40f });
    
    for (let i = 0; i < 4; i++) {
      const line = new THREE.Mesh(roadLineGeo, roadLineMat);
      line.position.set(15 + (i * 12), 0.01, 0);
      this.scene.add(line);
    }
  }

  private startAnimationLoop(): void {
    this.ngZone.runOutsideAngular(() => {
      const render = () => {
        this.frameId = requestAnimationFrame(render);
        if (this.controls) this.controls.update();
        if (this.renderer && this.scene && this.camera) {
          this.renderer.render(this.scene, this.camera);
        }
      };
      render();
    });
  }
}

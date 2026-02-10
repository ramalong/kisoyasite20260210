import * as THREE from "three";
import * as CANNON from "cannon-es";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

// ==========================================
// 設定項目
// ==========================================
const CONFIG = {
  targetSize: 1.5,
  wallPadding: 1.0,

  // --- ここを調整 ---
  repelRadius: 2.0, // 反応距離
  repelStrength: 5, // 反発強度
  // 提供されたファイルリスト
  models: [
    "Planet.glb",
    "Stag.glb",
    "Light Desk.glb",
    "Shiba Inu.glb",
    "cartoon banana car.glb",
    "Tree.glb",
    "Clouds.glb",
    "Cow.glb",
    "Toilet.glb",
    "Bathroom Toilet Paper.glb",
    "Toilet Paper stack.glb",
    "Mug With Office Tool.glb",
    "Tissue Box.glb",
    "Houseplant.glb",
    "Chicken.glb",
    "Cupcake.glb",
    "Donut.glb",
    "Coffee cup.glb",
    "Bottle Musterd.glb",
    "Burger.glb",
    "Coin.glb",
    "Cat.glb",
    "Pumpkin.glb",
    "Road Cone.glb",
    "Simple Standing Lamp.glb",
    "Bread Half.glb",
    "Bread Slice.glb",
    "Pencil.glb",
    "Pen.glb",
    "Pen (1).glb",
    "White Eraser.glb",
    "clipboard.glb",
  ],
};

export const initHeroScene = (container: HTMLElement) => {
  if (!container) return;

  // ==========================================
  // 初期化処理
  // ==========================================
  const scene = new THREE.Scene();

  // カメラ設定
  const camera = new THREE.PerspectiveCamera(
    45,
    container.clientWidth / container.clientHeight,
    0.1,
    100
  );
  camera.position.set(0, 0, 20);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  // ★重要: GLTFのモデルを正しく明るく表示するためにSRGBカラースペースを設定
  renderer.outputColorSpace = THREE.SRGBColorSpace; 
  container.appendChild(renderer.domElement);

  // ==========================================
  // 物理エンジンのセットアップ
  // ==========================================
  const world = new CANNON.World();
  world.gravity.set(0, 0, 0);
  world.broadphase = new CANNON.SAPBroadphase(world);

  const defaultMaterial = new CANNON.Material("default");
  const defaultContactMaterial = new CANNON.ContactMaterial(
    defaultMaterial,
    defaultMaterial,
    {
      friction: 0.3,
      restitution: 0.6, // 少し弾む
    }
  );
  world.addContactMaterial(defaultContactMaterial);

  // ==========================================
  // ライティング
  // ==========================================
  // 全体を明るく底上げする
  const ambientLight = new THREE.AmbientLight(0xffffff, 2.0); // 1.2 -> 2.0
  scene.add(ambientLight);

  // メインの光
  const dirLight = new THREE.DirectionalLight(0xffffff, 3.0); // 2.0 -> 3.0
  dirLight.position.set(10, 20, 10);
  dirLight.castShadow = true;
  dirLight.shadow.mapSize.width = 2048;
  dirLight.shadow.mapSize.height = 2048;
  scene.add(dirLight);

  // ==========================================
  // オブジェクト管理とロード処理
  // ==========================================
  const physicsObjects: { mesh: THREE.Group; body: CANNON.Body }[] = [];
  const loader = new GLTFLoader();

  // モバイル判定（768px未満なら数を制限）
  const isMobile = window.innerWidth < 768;
  const limit = isMobile ? 15 : CONFIG.models.length;
  // ランダムに選ぶとなお良いが、とりあえず先頭から制限
  const targetModels = CONFIG.models.slice(0, limit);

  targetModels.forEach((fileName) => {
    const url = `/models/${fileName}`;

    loader.load(
      url,
      (gltf) => {
        const model = gltf.scene;

        model.traverse((node) => {
          const mesh = node as THREE.Mesh;
          if (mesh.isMesh) {
            mesh.castShadow = true;
            mesh.receiveShadow = true;
          }
        });

        // --- 1. サイズの自動正規化 ---
        const box = new THREE.Box3().setFromObject(model);
        const size = new THREE.Vector3();
        box.getSize(size);

        const maxDimension = Math.max(size.x, size.y, size.z);
        const scaleFactor = CONFIG.targetSize / (maxDimension || 1);

        model.scale.setScalar(scaleFactor);

        // 中心位置補正
        const center = new THREE.Vector3();
        box.getCenter(center);
        model.position.sub(center.multiplyScalar(scaleFactor));

        const meshGroup = new THREE.Group();
        meshGroup.add(model);
        scene.add(meshGroup);

        // --- 2. 物理ボディの生成 ---
        // ターゲットサイズの半分を半径とする（これでほぼ見た目通りになる）
        const radius = CONFIG.targetSize * 0.5;
        const shape = new CANNON.Sphere(radius);

        const body = new CANNON.Body({
          mass: 1,
          material: defaultMaterial,
          position: new CANNON.Vec3(
            (Math.random() - 0.5) * 5,
            (Math.random() - 0.5) * 5,
            0
          ),
          angularDamping: 0.99, // 回転の抵抗
          linearDamping: 0.7, // 移動の抵抗
          fixedRotation: true, // 回転を禁止（自然な見た目のため初期回転は維持される）
        });

        body.addShape(shape);

        body.quaternion.setFromEuler(
          Math.random() * Math.PI,
          Math.random() * Math.PI,
          Math.random() * Math.PI
        );

        world.addBody(body);
        physicsObjects.push({ mesh: meshGroup, body: body });
      },
      undefined,
      (error) => console.error(`Load error: ${fileName}`, error)
    );
  });

  // ==========================================
  // 壁の作成（修正版：内側にパディングを設定）
  // ==========================================
  const walls: CANNON.Body[] = [];

  function createWalls() {
    walls.forEach((body) => world.removeBody(body));
    walls.length = 0;

    // 現在のカメラで見えている範囲（ワールド座標）を計算
    const aspect = container!.clientWidth / container!.clientHeight;
    const vFov = (camera.fov * Math.PI) / 180;
    const visibleHeight = 2 * Math.tan(vFov / 2) * camera.position.z;
    const visibleWidth = visibleHeight * aspect;

    // ★★ ここが修正ポイント ★★
    // 画面の端から、設定したパディング分だけ内側に壁を作る
    // これにより、オブジェクトの半径分が画面外に出るのを防ぐ
    const w = visibleWidth - CONFIG.wallPadding * 2;
    const h = visibleHeight - CONFIG.wallPadding * 2;

    const wallThickness = 5;
    const wallMaterial = defaultMaterial;

    const addWall = (
      x: number,
      y: number,
      z: number,
      sizeX: number,
      sizeY: number,
      sizeZ: number
    ) => {
      const body = new CANNON.Body({
        type: CANNON.Body.STATIC,
        material: wallMaterial,
      });
      body.addShape(
        new CANNON.Box(new CANNON.Vec3(sizeX / 2, sizeY / 2, sizeZ / 2))
      );
      body.position.set(x, y, z);
      world.addBody(body);
      walls.push(body);
    };

    // 上下左右の壁の位置を「内側サイズ(w, h)」に基づいて決定
    addWall(0, h / 2 + wallThickness / 2, 0, w, wallThickness, 10); // 上
    addWall(0, -h / 2 - wallThickness / 2, 0, w, wallThickness, 10); // 下
    addWall(-w / 2 - wallThickness / 2, 0, 0, wallThickness, h, 10); // 左
    addWall(w / 2 + wallThickness / 2, 0, 0, wallThickness, h, 10); // 右
    addWall(0, 0, -5, w + 10, h + 10, 1); // 奥
    addWall(0, 0, 5, w + 10, h + 10, 1); // 手前
  }
  createWalls();

  // ==========================================
  // マウスインタラクション（修正版：バグ修正）
  // ==========================================
  const mouse = new THREE.Vector2();
  // 初期値を画面外にして誤作動防止
  const mouseWorldPos = new THREE.Vector3(9999, 9999, 0);

  const onMouseMove = (event: MouseEvent) => {
    // コンテナ内の相対座標を計算
    const rect = container.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    mouse.x = (x / container.clientWidth) * 2 - 1;
    mouse.y = -(y / container.clientHeight) * 2 + 1;

    // ★★ ここが修正ポイント ★★
    // 以前のコードでは mouseWorldPos 自体を書き換えてしまい計算が破綻していた
    // 一時変数 vector を使うことで正しく方向を計算する
    const vector = new THREE.Vector3(mouse.x, mouse.y, 0.5);
    vector.unproject(camera);
    vector.sub(camera.position).normalize();

    const distance = -camera.position.z / vector.z;
    mouseWorldPos.copy(camera.position).add(vector.multiplyScalar(distance));
  };

  window.addEventListener("mousemove", onMouseMove);

  // ==========================================
  // アニメーションループ
  // ==========================================
  const clock = new THREE.Clock();

  function animate() {
    requestAnimationFrame(animate);
    const deltaTime = Math.min(clock.getDelta(), 0.1);

    world.step(1 / 60, deltaTime, 3);

    physicsObjects.forEach((obj) => {
      obj.mesh.position.copy(obj.body.position);
      obj.mesh.quaternion.copy(obj.body.quaternion);

      // マウス反発処理
      const dx = obj.body.position.x - mouseWorldPos.x;
      const dy = obj.body.position.y - mouseWorldPos.y;
      const distSq = dx * dx + dy * dy;

      // 距離チェック（近すぎる場合の0除算エラーも防止）
      if (distSq < CONFIG.repelRadius * CONFIG.repelRadius && distSq > 0.0001) {
        const dist = Math.sqrt(distSq);
        const force = (CONFIG.repelRadius - dist) * CONFIG.repelStrength;

        const nx = dx / dist;
        const ny = dy / dist;

        obj.body.wakeUp(); // スリープ解除
        obj.body.applyImpulse(
          new CANNON.Vec3(nx * force, ny * force, 0),
          obj.body.position
        );
      }
    });

    renderer.render(scene, camera);
  }

  animate();

  const onResize = () => {
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
    createWalls(); // リサイズ時もパディング付きで再計算
  };

  window.addEventListener("resize", onResize);
};

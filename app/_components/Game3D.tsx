"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { PointerLockControls } from "three/addons/controls/PointerLockControls.js";

interface MemoryFragment {
  mesh: THREE.Mesh;
  lyric: string;
  collected: boolean;
}

export default function Game3D() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [showStartButton, setShowStartButton] = useState(true);
  const [showLyric, setShowLyric] = useState(false);
  const [currentLyric, setCurrentLyric] = useState("");
  const [collectedCount, setCollectedCount] = useState(0);
  const totalFragments = 5;

  // Sprite generator (declared first so the rest of the effect can reference it)
  function generateSprite() {
    const canvas = document.createElement("canvas");
    canvas.width = 16;
    canvas.height = 16;

    const context = canvas.getContext("2d");
    if (context) {
      const gradient = context.createRadialGradient(
        canvas.width / 2,
        canvas.height / 2,
        0,
        canvas.width / 2,
        canvas.height / 2,
        canvas.width / 2
      );
      gradient.addColorStop(0, "rgba(255,255,255,1)");
      gradient.addColorStop(0.2, "rgba(0,255,255,1)");
      gradient.addColorStop(0.4, "rgba(0,0,64,1)");
      gradient.addColorStop(1, "rgba(0,0,0,1)");

      context.fillStyle = gradient;
      context.fillRect(0, 0, canvas.width, canvas.height);
    }

    return new THREE.CanvasTexture(canvas);
  }

  useEffect(() => {
    if (!containerRef.current) return;

    const container = containerRef.current;

    // === Scene ===
    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x000000, 0.001);

    // === Stars ===
    const starGeometry = new THREE.BufferGeometry();
    const starMaterial = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 0.5,
      transparent: true,
      blending: THREE.AdditiveBlending,
      map: generateSprite(),
    });

    const starVertices: number[] = [];
    for (let i = 0; i < 50000; i++) {
      const x = (Math.random() - 0.5) * 2000;
      const y = (Math.random() - 0.5) * 2000;
      const z = (Math.random() - 0.5) * 2000;
      starVertices.push(x, y, z);
    }
    starGeometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(starVertices, 3)
    );
    const stars = new THREE.Points(starGeometry, starMaterial);
    scene.add(stars);

    // === Camera ===
    const camera = new THREE.PerspectiveCamera(
      75,
      window.innerWidth / window.innerHeight,
      0.1,
      1000
    );
    camera.position.y = 2;

    // === Renderer ===
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(renderer.domElement);

    // === Lights ===
    const ambientLight = new THREE.AmbientLight(0x404040);
    const pointLight = new THREE.PointLight(0xffffff, 1, 100);
    pointLight.position.set(0, 10, 0);
    scene.add(ambientLight, pointLight);

    // === Ground ===
    const groundGeometry = new THREE.PlaneGeometry(100, 100);
    const groundMaterial = new THREE.MeshStandardMaterial({
      color: 0x1a1a1a,
      roughness: 0.8,
      metalness: 0.2,
    });
    const ground = new THREE.Mesh(groundGeometry, groundMaterial);
    ground.rotation.x = -Math.PI / 2;
    scene.add(ground);

    // === Controls ===
    const controls = new PointerLockControls(camera, document.body);

    // === Memory Fragments ===
    const lyrics = [
      "Seeing this makes it easy, easier to fall",
      "You're breathing softly, but so much stronger on your own",
      "I am not enough, I'm not the demons in your lungs",
      "I read your note, and I know just what you want to hear",
      "Time may heal the deepest wounds, but a severed limb is gone for good",
    ];

    const fragments: MemoryFragment[] = [];
    for (let i = 0; i < totalFragments; i++) {
      const geometry = new THREE.SphereGeometry(0.3, 32, 32);
      const material = new THREE.MeshPhongMaterial({
        color: 0x00ffff,
        emissive: 0x00ffff,
        emissiveIntensity: 0.5,
        transparent: true,
        opacity: 0.8,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(Math.random() * 40 - 20, 1.5, Math.random() * 40 - 20);

      fragments.push({ mesh, lyric: lyrics[i], collected: false });
      scene.add(mesh);
    }

    // === Movement state ===
    const moveState = {
      forward: false,
      backward: false,
      left: false,
      right: false,
      speed: 0.1,
    };

    const onKeyDown = (event: KeyboardEvent) => {
      switch (event.code) {
        case "ArrowUp":
        case "KeyW":
          moveState.forward = true;
          break;
        case "ArrowDown":
        case "KeyS":
          moveState.backward = true;
          break;
        case "ArrowLeft":
        case "KeyA":
          moveState.left = true;
          break;
        case "ArrowRight":
        case "KeyD":
          moveState.right = true;
          break;
      }
    };

    const onKeyUp = (event: KeyboardEvent) => {
      switch (event.code) {
        case "ArrowUp":
        case "KeyW":
          moveState.forward = false;
          break;
        case "ArrowDown":
        case "KeyS":
          moveState.backward = false;
          break;
        case "ArrowLeft":
        case "KeyA":
          moveState.left = false;
          break;
        case "ArrowRight":
        case "KeyD":
          moveState.right = false;
          break;
      }
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);

    // === Movement (per frame) ===
    const handleMovement = () => {
      if (!controls.isLocked) return;

      const direction = new THREE.Vector3();
      const frontVector = new THREE.Vector3();
      const sideVector = new THREE.Vector3();

      if (moveState.forward) frontVector.z -= 1;
      if (moveState.backward) frontVector.z += 1;
      if (moveState.left) sideVector.x -= 1;
      if (moveState.right) sideVector.x += 1;

      direction
        .subVectors(frontVector, sideVector)
        .normalize()
        .multiplyScalar(moveState.speed);

      controls.moveRight(-direction.x);
      controls.moveForward(-direction.z);
    };

    // === Fragment collection check ===
    const checkFragmentCollection = () => {
      if (!controls.isLocked) return;

      const playerPosition = camera.position;
      fragments.forEach((fragment) => {
        if (!fragment.collected) {
          const distance = playerPosition.distanceTo(fragment.mesh.position);
          if (distance < 2) {
            fragment.collected = true;
            fragment.mesh.visible = false;
            setCollectedCount((c) => c + 1);
            setCurrentLyric(fragment.lyric);
            setShowLyric(true);
            setTimeout(() => setShowLyric(false), 5000);
          }
        }
      });
    };

    // === Animation loop ===
    let animationId = 0;
    const animate = () => {
      animationId = requestAnimationFrame(animate);
      handleMovement();
      checkFragmentCollection();

      // rotate stars
      stars.rotation.y += 0.0005;

      // rotate fragments & bobbing
      fragments.forEach((fragment) => {
        if (!fragment.collected) {
          fragment.mesh.rotation.y += 0.01;
          fragment.mesh.position.y = 1.5 + Math.sin(Date.now() * 0.002) * 0.1;
        }
      });

      renderer.render(scene, camera);
    };
    animate();

    // === Resize ===
    const onResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener("resize", onResize);

    // === Cleanup ===
    return () => {
      cancelAnimationFrame(animationId);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("resize", onResize);
      controls.dispose();
      starGeometry.dispose();
      starMaterial.dispose();
      groundGeometry.dispose();
      groundMaterial.dispose();
      fragments.forEach((f) => {
        f.mesh.geometry.dispose();
        if (Array.isArray(f.mesh.material)) {
          f.mesh.material.forEach((m) => m.dispose());
        } else {
          f.mesh.material.dispose();
        }
      });
      renderer.dispose();
      if (renderer.domElement.parentNode) {
        renderer.domElement.parentNode.removeChild(renderer.domElement);
      }
    };
  }, []);

  const handleStart = () => {
    setShowStartButton(false);
    // PointerLockControls requires a user gesture; requestPointerLock on body
    // is acceptable here since the button click is itself a gesture.
    document.body.requestPointerLock?.();
  };

  return (
    <div id="game-container">
      {showStartButton && (
        <div className="start-screen">
          <button onClick={handleStart} className="start-button">
            开始游戏
          </button>
        </div>
      )}
      {showLyric && <div className="lyric-display">{currentLyric}</div>}
      <div className="fragment-counter">
        记忆碎片: {collectedCount} / {totalFragments}
      </div>
      <div ref={containerRef} style={{ width: "100vw", height: "100vh" }} />
    </div>
  );
}
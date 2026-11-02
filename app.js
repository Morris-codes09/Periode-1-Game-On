const SERVICE_UUID = "19b10000-e8f2-537e-4f6c-d104768a1214";
const CHARACTERISTIC_UUID = "19b10001-e8f2-537e-4f6c-d104768a1214";
const DEVICE_NAME = "Morris Nano ESP 32";

const state = {
  device: null,
  server: null,
  characteristic: null,
  isConnected: false,
  speed: 5,
  repeatTimer: null,
  installPrompt: null,
};

const statusDot = document.getElementById("statusDot");
const statusText = document.getElementById("statusText");
const errorBox = document.getElementById("errorBox");
const connectBtn = document.getElementById("connectBtn");
const disconnectBtn = document.getElementById("disconnectBtn");
const stopBtn = document.getElementById("stopBtn");
const speedSlider = document.getElementById("speedSlider");
const speedValue = document.getElementById("speedValue");
const installBtn = document.getElementById("installBtn");

function setStatus(label, stateName = "disconnected") {
  statusText.textContent = label;
  statusDot.className = `status-dot ${stateName}`;
}

function setError(message) {
  if (!message) {
    errorBox.hidden = true;
    errorBox.textContent = "";
    return;
  }

  errorBox.hidden = false;
  errorBox.textContent = message;
}

function buttonEnabled(enable) {
  connectBtn.disabled = !enable;
  disconnectBtn.disabled = !state.isConnected;
}

async function writeCommand(command) {
  if (!state.device || !state.characteristic) {
    return false;
  }

  const value = new TextEncoder().encode(String(command));

  try {
    if (state.characteristic.properties.write) {
      await state.characteristic.writeValue(value);
      return true;
    }

    if (state.characteristic.properties.writeWithoutResponse) {
      await state.characteristic.writeValue(value, { withoutResponse: true });
      return true;
    }

    throw new Error("This BLE characteristic does not support writing.");
  } catch (error) {
    try {
      if (state.characteristic.properties.writeWithoutResponse) {
        await state.characteristic.writeValue(value, { withoutResponse: true });
        return true;
      }
    } catch (fallbackError) {
      console.error("BLE write failed", fallbackError);
      setError(`Write failed: ${fallbackError.message || "unknown BLE write error"}`);
      return false;
    }

    console.error("BLE write error", error);
    setError(`Write failed: ${error.message || "unknown BLE error"}`);
    return false;
  }
}

function stopDirectionLoop() {
  if (state.repeatTimer) {
    clearInterval(state.repeatTimer);
    state.repeatTimer = null;
  }
}

async function sendStop() {
  if (!state.isConnected) {
    return;
  }

  await writeCommand("S");
}

async function connectRobot() {
  if (!navigator.bluetooth) {
    setError("Web Bluetooth is not supported in this browser. Use Android Chrome on HTTPS.");
    setStatus("Unsupported", "disconnected");
    return;
  }

  if (!window.isSecureContext) {
    setError("This page must be served over HTTPS or localhost for Web Bluetooth to work.");
    setStatus("Insecure", "disconnected");
    return;
  }

  try {
    setStatus("Connecting…", "connecting");
    setError("");

    let device;
    try {
      device = await navigator.bluetooth.requestDevice({
        filters: [{ name: DEVICE_NAME }],
        optionalServices: [SERVICE_UUID],
      });
    } catch (exactError) {
      console.warn("Exact-name filter failed; falling back to all devices.", exactError);
      device = await navigator.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: [SERVICE_UUID],
      });
    }

    device.addEventListener("gattserverdisconnected", async () => {
      stopDirectionLoop();
      state.isConnected = false;
      state.device = null;
      state.server = null;
      state.characteristic = null;
      setStatus("Disconnected", "disconnected");
      setError("BLE connection was lost.");
      buttonEnabled(true);
    });

    const server = await device.gatt.connect();

    let service;
    try {
      service = await server.getPrimaryService(SERVICE_UUID);
    } catch (serviceError) {
      console.warn("Service lookup failed; trying alternate service discovery.", serviceError);
      const services = await server.getPrimaryServices();
      service = services.find((candidate) => candidate.uuid.toLowerCase() === SERVICE_UUID);
      if (!service) {
        throw new Error("The ESP32 service was not found. Check the BLE service UUID and the device is advertising it.");
      }
    }

    const characteristic = await service.getCharacteristic(CHARACTERISTIC_UUID);

    if (!characteristic.properties.write && !characteristic.properties.writeWithoutResponse) {
      throw new Error("The robot characteristic is not writable.");
    }

    state.device = device;
    state.server = server;
    state.characteristic = characteristic;
    state.isConnected = true;

    setStatus("Connected", "connected");
    setError("");
    buttonEnabled(true);

    await sendStop();
  } catch (error) {
    console.error("Connection error", error);
    state.isConnected = false;
    state.device = null;
    state.server = null;
    state.characteristic = null;
    setStatus("Disconnected", "disconnected");
    setError(error.message || "Could not connect to the robot. Make sure the ESP32 is advertising as Morris Nano ESP 32 and is powered on.");
    buttonEnabled(true);
  }
}

async function disconnectRobot() {
  stopDirectionLoop();

  if (!state.device) {
    setStatus("Disconnected", "disconnected");
    setError("");
    return;
  }

  try {
    await sendStop();
  } catch (error) {
    console.warn("Stop before disconnect failed", error);
  }

  try {
    if (state.device.gatt && state.device.gatt.connected) {
      state.device.gatt.disconnect();
    }
  } finally {
    state.isConnected = false;
    state.device = null;
    state.server = null;
    state.characteristic = null;
    setStatus("Disconnected", "disconnected");
    setError("");
    buttonEnabled(true);
  }
}

function startDirection(direction) {
  if (!state.isConnected) {
    setError("Connect to the robot before sending movement commands.");
    return;
  }

  stopDirectionLoop();
  state.repeatTimer = setInterval(() => {
    writeCommand(direction);
  }, 120);
  writeCommand(direction);
}

function endDirection() {
  stopDirectionLoop();
  sendStop();
}

function setupDirectionButtons() {
  document.querySelectorAll(".move-btn").forEach((button) => {
    const direction = button.dataset.direction;

    const press = (event) => {
      event.preventDefault();
      button.classList.add("active");
      startDirection(direction);
    };

    const release = (event) => {
      event.preventDefault();
      button.classList.remove("active");
      endDirection();
    };

    button.addEventListener("pointerdown", press);
    button.addEventListener("pointerup", release);
    button.addEventListener("pointerleave", release);
    button.addEventListener("pointercancel", release);
    button.addEventListener("contextmenu", (event) => event.preventDefault());
  });
}

function setupSpeedSlider() {
  speedSlider.addEventListener("input", () => {
    state.speed = Number(speedSlider.value);
    speedValue.textContent = String(state.speed);

    if (state.isConnected) {
      writeCommand(String(state.speed));
    }
  });
}

function setupInstallPrompt() {
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    state.installPrompt = event;
    installBtn.hidden = false;
  });

  installBtn.addEventListener("click", async () => {
    if (!state.installPrompt) {
      setError("This browser does not currently allow app installation from this page.");
      return;
    }

    state.installPrompt.prompt();
    const result = await state.installPrompt.userChoice;
    console.log("Install choice:", result.outcome);
    installBtn.hidden = true;
    state.installPrompt = null;
  });
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    return;
  }

  try {
    await navigator.serviceWorker.register("./service-worker.js", { scope: "./" });
  } catch (error) {
    console.warn("Service worker registration failed", error);
  }
}

function initialize() {
  buttonEnabled(true);
  setStatus("Disconnected", "disconnected");
  setError("");
  setupDirectionButtons();
  setupSpeedSlider();
  setupInstallPrompt();
  registerServiceWorker();

  connectBtn.addEventListener("click", () => {
    connectRobot();
  });

  disconnectBtn.addEventListener("click", () => {
    disconnectRobot();
  });

  stopBtn.addEventListener("click", async () => {
    stopDirectionLoop();
    if (state.isConnected) {
      await sendStop();
    }
  });

  window.addEventListener("pagehide", () => {
    stopDirectionLoop();
    if (state.isConnected) {
      sendStop().catch(() => {});
    }
  });
}

initialize();

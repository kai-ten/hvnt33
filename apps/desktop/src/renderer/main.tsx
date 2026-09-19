// The Electron build of hvnt33: the shared interface over the preload bridge.
import { mount, type NativeBridge } from "@hvnt33/ui";

mount(document.getElementById("root")!, (window as unknown as { hvnt33: NativeBridge }).hvnt33);

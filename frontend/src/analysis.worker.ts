import { analyze } from "../../shared/track";
self.onmessage = (event) => {
  const { id, points, lines } = event.data;
  self.postMessage({ id, result: analyze(points, { lines }) });
};

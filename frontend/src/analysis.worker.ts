import { analyze } from "../../shared/track";
self.onmessage = (event) => {
  const { id, points, lines, areas } = event.data;
  self.postMessage({ id, result: analyze(points, { lines, areas }) });
};

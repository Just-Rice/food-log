// Runs Gemma 4 E2B on this device, in a worker so the page stays responsive
// while it loads and reads a photo. Nothing here touches the network except
// to fetch the model once; Transformers.js keeps the files in the browser's
// Cache Storage ("transformers-cache") so later visits load from disk.
//
// Messages in:  {type: 'load', dtype}
//               {type: 'run', id, prompt, image}   image is a data: URL
// Messages out: {type: 'progress', loaded, total, file}
//               {type: 'loaded'}
//               {type: 'token', id, count}
//               {type: 'result', id, text}
//               {type: 'error', id?, message}

import {
  AutoProcessor,
  Gemma4ForConditionalGeneration,
  RawImage,
  TextStreamer,
  env
} from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.1/dist/transformers.min.js';

const MODEL_ID = 'onnx-community/gemma-4-E2B-it-ONNX';

env.allowLocalModels = false;
env.useBrowserCache = true;

let processor = null;
let model = null;
let loading = null;

function post(type, data) {
  self.postMessage(Object.assign({ type: type }, data || {}));
}

function load(dtype) {
  if (model) return Promise.resolve();
  if (loading) return loading;
  loading = (async () => {
    processor = await AutoProcessor.from_pretrained(MODEL_ID);
    model = await Gemma4ForConditionalGeneration.from_pretrained(MODEL_ID, {
      // q4f16 needs the GPU's shader-f16 feature; q4 is the fallback, a few
      // hundred megabytes larger. The page checks which this device has.
      dtype: dtype === 'q4' ? 'q4' : 'q4f16',
      // Everything on the GPU. The per-layer embedding table would be the
      // natural part to move to the CPU, but the browser build of ONNX Runtime
      // has no CPU kernel for its 4-bit lookup (GatherBlockQuantized), and the
      // 16-bit table that it could run is a 5.5 GB download. So the device
      // check in local-model.js requires a GPU that can hold that table as a
      // single 1.17 GB buffer, rather than letting the first photo fail.
      device: 'webgpu',
      progress_callback: (info) => {
        if (info.status === 'progress_total') {
          post('progress', { loaded: info.loaded, total: info.total, file: info.name || '' });
        }
      }
    });
  })().catch((err) => {
    loading = null;
    processor = null;
    model = null;
    throw err;
  });
  return loading;
}

async function run(id, prompt, imageUrl, dtype) {
  await load(dtype);
  const messages = [{ role: 'user', content: [{ type: 'image' }, { type: 'text', text: prompt }] }];
  const text = processor.apply_chat_template(messages, {
    enable_thinking: false,
    add_generation_prompt: true
  });
  const image = await RawImage.fromURL(imageUrl);
  const inputs = await processor(text, image, null, { add_special_tokens: false });

  let count = 0;
  const streamer = new TextStreamer(processor.tokenizer, {
    skip_prompt: true,
    skip_special_tokens: true,
    token_callback_function: () => {
      count++;
      if (count % 8 === 0) post('token', { id: id, count: count });
    }
  });
  const out = await model.generate({
    ...inputs,
    // Twelve items at most, each a short JSON object: well under this.
    max_new_tokens: 1200,
    // Greedy decoding: the same photo should give the same answer.
    do_sample: false,
    streamer: streamer
  });
  const decoded = processor.batch_decode(
    out.slice(null, [inputs.input_ids.dims.at(-1), null]),
    { skip_special_tokens: true }
  );
  return decoded[0] || '';
}

function message(err) {
  const m = err && err.message ? err.message : String(err);
  // WebGPU allocation failures surface with a variety of wordings.
  if (/out of memory|allocation|OOM|device (was )?lost|createBuffer|max buffer size|Invalid Buffer|validation failed/i.test(m)) {
    return 'This device ran out of graphics memory loading the model. It may be too large for this ' +
      'phone or browser; closing other tabs can help.';
  }
  return m;
}

self.onmessage = async (ev) => {
  const d = ev.data || {};
  if (d.type === 'load') {
    try {
      await load(d.dtype);
      post('loaded');
    } catch (err) {
      post('error', { message: message(err) });
    }
  } else if (d.type === 'run') {
    try {
      const text = await run(d.id, d.prompt, d.image, d.dtype);
      post('result', { id: d.id, text: text });
    } catch (err) {
      post('error', { id: d.id, message: message(err) });
    }
  }
};

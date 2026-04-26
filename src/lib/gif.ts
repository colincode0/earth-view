type GifFrame = {
  imageUrl: string;
  delayMs: number;
};

function writeAscii(bytes: number[], value: string) {
  for (let index = 0; index < value.length; index += 1) {
    bytes.push(value.charCodeAt(index));
  }
}

function writeShort(bytes: number[], value: number) {
  bytes.push(value & 0xff, (value >> 8) & 0xff);
}

function colorIndex(red: number, green: number, blue: number) {
  return ((red >> 5) << 5) | ((green >> 5) << 2) | (blue >> 6);
}

function buildPalette() {
  const palette: number[] = [];

  for (let red = 0; red < 8; red += 1) {
    for (let green = 0; green < 8; green += 1) {
      for (let blue = 0; blue < 4; blue += 1) {
        palette.push(
          Math.round((red / 7) * 255),
          Math.round((green / 7) * 255),
          Math.round((blue / 3) * 255),
        );
      }
    }
  }

  return palette;
}

function lzwEncode(indices: Uint8Array) {
  const output: number[] = [];
  let current = 0;
  let bitCount = 0;
  let codeSize = 9;
  const clearCode = 256;
  const endCode = 257;
  const dictionary = new Map<string, number>();
  let nextCode = 258;
  let prefix = String(indices[0]);

  function writeCode(code: number) {
    current |= code << bitCount;
    bitCount += codeSize;

    while (bitCount >= 8) {
      output.push(current & 0xff);
      current >>= 8;
      bitCount -= 8;
    }

    if (code === clearCode) {
      codeSize = 9;
    }
  }

  writeCode(clearCode);

  for (let index = 1; index < indices.length; index += 1) {
    const value = indices[index];
    const key = `${prefix},${value}`;

    if (dictionary.has(key)) {
      prefix = key;
      continue;
    }

    writeCode(dictionary.get(prefix) ?? Number(prefix));

    if (nextCode < 4096) {
      dictionary.set(key, nextCode);
      nextCode += 1;

      if (nextCode === 1 << codeSize && codeSize < 12) {
        codeSize += 1;
      }
    } else {
      writeCode(clearCode);
      dictionary.clear();
      nextCode = 258;
      codeSize = 9;
    }

    prefix = String(value);
  }

  writeCode(dictionary.get(prefix) ?? Number(prefix));
  writeCode(endCode);

  if (bitCount > 0) {
    output.push(current & 0xff);
  }

  return output;
}

function writeImageData(bytes: number[], indices: Uint8Array) {
  bytes.push(8);

  const encoded = lzwEncode(indices);

  for (let index = 0; index < encoded.length; index += 255) {
    const block = encoded.slice(index, index + 255);
    bytes.push(block.length, ...block);
  }

  bytes.push(0);
}

function loadImage(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = url;
  });
}

async function frameToIndices(
  frame: GifFrame,
  canvas: HTMLCanvasElement,
  context: CanvasRenderingContext2D,
) {
  const image = await loadImage(frame.imageUrl);

  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  const imageData = context.getImageData(0, 0, canvas.width, canvas.height).data;
  const indices = new Uint8Array(canvas.width * canvas.height);

  for (let sourceIndex = 0, targetIndex = 0; sourceIndex < imageData.length; sourceIndex += 4) {
    indices[targetIndex] = colorIndex(
      imageData[sourceIndex],
      imageData[sourceIndex + 1],
      imageData[sourceIndex + 2],
    );
    targetIndex += 1;
  }

  return indices;
}

export async function createAnimatedGif(frames: GifFrame[], size = 512) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;

  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("Could not create a canvas for GIF export.");
  }

  const bytes: number[] = [];
  writeAscii(bytes, "GIF89a");
  writeShort(bytes, size);
  writeShort(bytes, size);
  bytes.push(0xf7, 0, 0);
  bytes.push(...buildPalette());
  bytes.push(0x21, 0xff, 0x0b);
  writeAscii(bytes, "NETSCAPE2.0");
  bytes.push(0x03, 0x01);
  writeShort(bytes, 0);
  bytes.push(0);

  for (const frame of frames) {
    const indices = await frameToIndices(frame, canvas, context);
    bytes.push(0x21, 0xf9, 0x04, 0x04);
    writeShort(bytes, Math.max(2, Math.round(frame.delayMs / 10)));
    bytes.push(0, 0);
    bytes.push(0x2c);
    writeShort(bytes, 0);
    writeShort(bytes, 0);
    writeShort(bytes, size);
    writeShort(bytes, size);
    bytes.push(0);
    writeImageData(bytes, indices);
  }

  bytes.push(0x3b);

  return new Blob([new Uint8Array(bytes)], { type: "image/gif" });
}

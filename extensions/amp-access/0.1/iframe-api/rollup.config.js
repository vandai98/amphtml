/**
 * Copyright 2018 The AMP HTML Authors. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS-IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import path from 'path';
import babel from 'rollup-plugin-babel';
import cleanup from 'rollup-plugin-cleanup';

export default {
  input: './amp-iframe-api-export.js',
  output: {
    name: 'AmpAccessIframeApi',
    format: 'umd',
    file: 'build/index.js',
    sourceMap: true,
  },
  plugins: [
    babel({
      babelrc: false,
      presets: [['env', {'modules': false}]],
    }),
    cleanup(),
  ],
  external: [path.resolve('../../../../src/polyfills/index.js')],
};

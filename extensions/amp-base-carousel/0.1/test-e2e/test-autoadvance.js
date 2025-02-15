/**
 * Copyright 2019 The AMP HTML Authors. All Rights Reserved.
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

import {getSlides} from './helpers';

const pageWidth = 800;
const pageHeight = 600;

describes.endtoend(
  'amp-base-carousel - autoadvance',
  {
    version: '0.1',
    fixture: 'amp-base-carousel/autoadvance.amp.html',
    experiments: ['amp-base-carousel', 'layers'],
    initialRect: {width: pageWidth, height: pageHeight},
  },
  (env) => {
    let controller;

    function rect(el) {
      return controller.getElementRect(el);
    }

    beforeEach(() => {
      controller = env.controller;
    });

    // TODO(sparhami): fails on shadow demo
    it.configure()
      .skipShadowDemo()
      .run('should move forwards', async function () {
        this.timeout(10000);
        const slides = await getSlides(controller);

        await expect(rect(slides[1])).to.include({x: 0});
        await expect(rect(slides[2])).to.include({x: 0});
        await expect(rect(slides[0])).to.include({x: 0});
      });

    it.skip('should not advance while the user is touching', async () => {
      // TODO(sparhami) Implement when touch actions are supported.
    });
  }
);

/**
 * Copyright 2020 The AMP HTML Authors. All Rights Reserved.
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

describes.endtoend(
  'amp-lightbox custom close button',
  {
    fixture: 'amp-lightbox/custom-close-button.amp.html',

    versions: {
      '1.0': {
        environments: ['single', 'viewer-demo'],
        experiments: ['bento'],
        initialRect: {width: 800, height: 800},
      },
    },
  },
  (env) => {
    let controller;

    beforeEach(() => {
      controller = env.controller;
    });

    it('should render correctly', async () => {
      const lightbox = await controller.findElement('#lightbox');
      await expect(controller.getElementProperty(lightbox, 'hidden')).to.be
        .true;

      const image = await controller.findElement('#image');
      await expect(
        controller.getElementProperty(image, 'clientWidth')
      ).to.equal(0);
    });

    // TODO(wg-components, #28948): Flaky during CI.
    it.skip('should open the lightbox', async () => {
      const open = await controller.findElement('#open');
      await controller.click(open);

      const lightbox = await controller.findElement('#lightbox');
      await expect(controller.getElementProperty(lightbox, 'hidden')).to.be
        .false;

      const documentElement = await controller.getDocumentElement();
      const width = await controller.getElementProperty(
        documentElement,
        'clientWidth'
      );
      await expect(
        controller.getElementProperty(lightbox, 'clientWidth')
      ).to.equal(width);

      const backingImageOrLoader = await controller.findElement(
        '#image img, #image .i-amphtml-loader-background'
      );
      await expect(
        controller.getElementProperty(backingImageOrLoader, 'clientWidth')
      ).to.equal(641);
    });

    it('should close the lightbox', async () => {
      const open = await controller.findElement('#open');
      await controller.click(open);

      const lightbox = await controller.findElement('#lightbox');
      await expect(controller.getElementProperty(lightbox, 'hidden')).to.be
        .false;

      const close = await controller.findElement('#close');
      await controller.click(close);

      await expect(controller.getElementProperty(lightbox, 'hidden')).to.be
        .true;
    });
  }
);

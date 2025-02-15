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

describes.endtoend(
  'amp-lightbox with amp-autocomplete',
  {
    version: '0.1',
    fixture: 'amp-lightbox/amp-lightbox-autocomplete.html',
    environments: 'ampdoc-preset',
  },
  (env) => {
    let controller;

    beforeEach(() => {
      controller = env.controller;
    });

    it('should show autocomplete options when lightbox opens', async () => {
      const open = await controller.findElement('#open');
      await controller.click(open);

      const results = await controller.findElement(
        '.i-amphtml-autocomplete-results'
      );
      await expect(controller.getElementProperty(results, 'hidden')).to.be
        .false;

      const options = await controller.findElements(
        '.i-amphtml-autocomplete-item'
      );
      // auto-complete options are apple, orange, banana.
      await expect(options).to.have.lengthOf(3);
    });
  }
);

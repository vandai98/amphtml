/**
 * Copyright 2016 The AMP HTML Authors. All Rights Reserved.
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

import {LayoutPriority} from '#core/dom/layout';
import {layoutRectLtwh} from '#core/dom/layout/rect';

import {Services} from '#service';
import {AmpDocSingle} from '#service/ampdoc-impl';
import {OwnersImpl} from '#service/owners-impl';
import {Resource, ResourceState} from '#service/resource';
import {ResourcesImpl} from '#service/resources-impl';

import {isCancellation} from '../../src/error-reporting';

describes.realWin('Resource', {amp: true}, (env) => {
  let win, doc;
  let element;
  let elementMock;
  let resources;
  let resource;

  beforeEach(() => {
    win = env.win;
    doc = win.document;

    element = env.createAmpElement('amp-fake-element');
    doc.body.appendChild(element);
    env.sandbox
      .stub(element, 'getLayoutPriority')
      .callsFake(() => LayoutPriority.ADS);
    elementMock = env.sandbox.mock(element);

    const viewer = Services.viewerForDoc(doc);
    env.sandbox.stub(viewer, 'isRuntimeOn').callsFake(() => false);
    env.sandbox
      .stub(ResourcesImpl.prototype, 'rebuildDomWhenReady_')
      .callsFake(() => {});
    resources = new ResourcesImpl(env.ampdoc);
    resource = new Resource(1, element, resources);
    element.resources_ = resources;

    const vsync = Services.vsyncFor(win);
    env.sandbox.stub(vsync, 'mutate').callsFake((mutator) => {
      mutator();
    });

    resources.win = {
      document,
      getComputedStyle: (el) => {
        return el.fakeComputedStyle
          ? el.fakeComputedStyle
          : window.getComputedStyle(el);
      },
    };
  });

  afterEach(() => {
    elementMock.verify();
  });

  it('should initialize correctly', () => {
    expect(resource.getId()).to.equal(1);
    expect(resource.debugid).to.equal('amp-fake-element#1');
    expect(resource.getLayoutPriority()).to.equal(LayoutPriority.ADS);
    expect(resource.getState()).to.equal(ResourceState.NOT_BUILT);
    expect(resource.getLayoutBox().width).to.equal(0);
    expect(resource.getLayoutBox().height).to.equal(0);
    expect(resource.isInViewport()).to.equal(false);
  });

  it('should initialize correctly when already built', () => {
    elementMock.expects('isBuilt').returns(true).once();
    expect(new Resource(1, element, resources).getState()).to.equal(
      ResourceState.NOT_LAID_OUT
    );
  });

  it('should not build before upgraded', () => {
    elementMock.expects('isUpgraded').returns(false).atLeast(1);
    elementMock.expects('buildInternal').never();
    elementMock.expects('updateLayoutBox').never();

    expect(resource.build()).to.be.null;
    expect(resource.getState()).to.equal(ResourceState.NOT_BUILT);
  });

  it('should build after upgraded', () => {
    const buildPromise = Promise.resolve();
    elementMock.expects('isUpgraded').returns(true).atLeast(1);
    elementMock.expects('buildInternal').returns(buildPromise).once();
    elementMock.expects('updateLayoutBox').never();
    return resource.build().then(() => {
      expect(resource.getState()).to.equal(ResourceState.NOT_LAID_OUT);
    });
  });

  it('should build if element is currently building', () => {
    elementMock.expects('isBuilt').returns(false).once();
    elementMock.expects('isBuilding').returns(true).once();
    elementMock.expects('isUpgraded').returns(true).once();
    elementMock.expects('buildInternal').returns(Promise.resolve()).once();
    const r = new Resource(2, element, resources);
    expect(r.isBuilding()).to.be.true;
  });

  it('should denylist on build failure', () => {
    env.sandbox
      .stub(resource, 'maybeReportErrorOnBuildFailure')
      .callsFake(() => {});
    elementMock.expects('isUpgraded').returns(true).atLeast(1);
    elementMock
      .expects('buildInternal')
      .returns(Promise.reject(new Error('intentional')))
      .once();
    elementMock.expects('updateLayoutBox').never();
    const buildPromise = resource.build();
    expect(resource.isBuilding()).to.be.true;
    return buildPromise.then(
      () => {
        throw new Error('must have failed');
      },
      () => {
        expect(resource.isBuilding()).to.be.false;
        expect(resource.getState()).to.equal(ResourceState.NOT_BUILT);
      }
    );
  });

  it('should mark as not ready for layout even if already measured', () => {
    const box = layoutRectLtwh(0, 0, 100, 200);
    elementMock.expects('isUpgraded').returns(true).atLeast(1);
    elementMock.expects('buildInternal').returns(Promise.resolve()).once();
    resource.layoutBox_ = box;
    return resource.build().then(() => {
      expect(resource.getState()).to.equal(ResourceState.NOT_LAID_OUT);
    });
  });

  it('should mark as not laid out if not yet measured', () => {
    elementMock.expects('isUpgraded').returns(true).atLeast(1);
    elementMock.expects('buildInternal').returns(Promise.resolve()).once();
    return resource.build().then(() => {
      expect(resource.getState()).to.equal(ResourceState.NOT_LAID_OUT);
    });
  });

  it('should track size changes on measure', () => {
    elementMock.expects('isUpgraded').returns(true).atLeast(1);
    elementMock.expects('buildInternal').returns(Promise.resolve()).once();
    return resource.build().then(() => {
      elementMock
        .expects('getBoundingClientRect')
        .returns({left: 11, top: 12, width: 111, height: 222})
        .once();
      elementMock
        .expects('updateLayoutBox')
        .withExactArgs(
          env.sandbox.match((data) => {
            return data.width == 111 && data.height == 222;
          }),
          true
        )
        .once();
      resource.measure();
    });
  });

  it('should track no size changes on measure', () => {
    layoutRectLtwh(0, 0, 0, 0);
    elementMock.expects('isUpgraded').returns(true).atLeast(1);
    elementMock.expects('buildInternal').returns(Promise.resolve()).once();
    return resource.build().then(() => {
      elementMock
        .expects('getBoundingClientRect')
        .returns({left: 0, top: 0, width: 0, height: 0})
        .once();
      elementMock
        .expects('updateLayoutBox')
        .withExactArgs(
          env.sandbox.match((data) => {
            return data.width == 0 && data.height == 0;
          }),
          false
        )
        .once();
      resource.measure();
    });
  });

  it('should allow to measure when not upgraded', () => {
    elementMock.expects('isUpgraded').returns(false).atLeast(1);
    const viewport = Services.viewportForDoc(resource.element);
    env.sandbox
      .stub(viewport, 'getLayoutRect')
      .returns(layoutRectLtwh(0, 100, 300, 100));
    env.sandbox.stub(viewport, 'isDeclaredFixed').returns(false);
    env.sandbox.stub(viewport, 'supportsPositionFixed').returns(true);
    expect(() => {
      resource.measure();
    }).to.not.throw();
    expect(resource.getLayoutBox()).to.eql(layoutRectLtwh(0, 100, 300, 100));
  });

  it('should allow measure even when not built', () => {
    elementMock.expects('isUpgraded').returns(true).atLeast(1);
    elementMock
      .expects('getBoundingClientRect')
      .returns(layoutRectLtwh(0, 0, 0, 0))
      .once();
    resource.measure();
    expect(resource.getState()).to.equal(ResourceState.NOT_BUILT);
    expect(resource.isFixed()).to.be.false;
  });

  it('should measure and update state', () => {
    elementMock.expects('isUpgraded').returns(true).atLeast(1);
    elementMock.expects('buildInternal').returns(Promise.resolve()).once();
    return resource.build().then(() => {
      elementMock
        .expects('getBoundingClientRect')
        .returns({left: 11, top: 12, width: 111, height: 222})
        .once();
      elementMock
        .expects('updateLayoutBox')
        .withExactArgs(
          env.sandbox.match((data) => {
            return data.width == 111 && data.height == 222;
          }),
          true
        )
        .once();
      resource.measure();
      expect(resource.getState()).to.equal(ResourceState.READY_FOR_LAYOUT);
      expect(resource.getLayoutBox().left).to.equal(11);
      expect(resource.getLayoutBox().top).to.equal(12);
      expect(resource.getLayoutBox().width).to.equal(111);
      expect(resource.getLayoutBox().height).to.equal(222);
      expect(resource.isFixed()).to.be.false;
    });
  });

  it('should update initial box only on first measure', () => {
    elementMock.expects('isUpgraded').returns(true).atLeast(1);
    elementMock.expects('buildInternal').returns(Promise.resolve()).once();
    return resource.build().then(() => {
      element.getBoundingClientRect = () => ({
        left: 11,
        top: 12,
        width: 111,
        height: 222,
      });
      resource.measure();
      expect(resource.getLayoutBox().top).to.equal(12);
      expect(resource.getInitialLayoutBox().top).to.equal(12);

      element.getBoundingClientRect = () => ({
        left: 11,
        top: 22,
        width: 111,
        height: 222,
      });
      resource.measure();
      expect(resource.getLayoutBox().top).to.equal(22);
      expect(resource.getInitialLayoutBox().top).to.equal(12);
    });
  });

  it('should request measure even when not built', () => {
    expect(resource.isMeasureRequested()).to.be.false;
    elementMock.expects('getBoundingClientRect').never();
    resource.requestMeasure();
    expect(resource.isMeasureRequested()).to.be.true;
  });

  it('should request measure when built', () => {
    expect(resource.isMeasureRequested()).to.be.false;
    elementMock.expects('getBoundingClientRect').never();
    resource.state_ = ResourceState.READY_FOR_LAYOUT;
    resource.requestMeasure();
    expect(resource.isMeasureRequested()).to.be.true;
  });

  it('should always layout if has not been laid out before', () => {
    elementMock.expects('isUpgraded').returns(true).atLeast(1);
    resource.state_ = ResourceState.NOT_LAID_OUT;
    resource.layoutBox_ = {left: 11, top: 12, width: 111, height: 222};

    elementMock
      .expects('getBoundingClientRect')
      .returns(resource.layoutBox_)
      .once();
    resource.measure();
    expect(resource.getState()).to.equal(ResourceState.READY_FOR_LAYOUT);
  });

  it('should not relayout if has box has not changed', () => {
    resource.state_ = ResourceState.LAYOUT_COMPLETE;
    resource.layoutBox_ = {left: 11, top: 12, width: 111, height: 222};

    // Left is not part of validation.
    elementMock
      .expects('getBoundingClientRect')
      .returns({left: 11 + 10, top: 12, width: 111, height: 222})
      .once();
    resource.measure();
    expect(resource.getState()).to.equal(ResourceState.LAYOUT_COMPLETE);
    expect(resource.getLayoutBox().left).to.equal(11 + 10);
  });

  it("should not relayout if box changed but element didn't opt in", () => {
    elementMock.expects('isUpgraded').returns(true).atLeast(1);
    resource.state_ = ResourceState.LAYOUT_COMPLETE;
    resource.layoutBox_ = {left: 11, top: 12, width: 111, height: 222};

    // Width changed.
    elementMock
      .expects('getBoundingClientRect')
      .returns({left: 11, top: 12, width: 111 + 10, height: 222})
      .once();
    elementMock.expects('isRelayoutNeeded').returns(false).atLeast(1);
    resource.measure();
    expect(resource.getState()).to.equal(ResourceState.LAYOUT_COMPLETE);
    expect(resource.getLayoutBox().width).to.equal(111 + 10);
  });

  it('should relayout if box changed when element opted in', () => {
    elementMock.expects('isUpgraded').returns(true).atLeast(1);
    resource.state_ = ResourceState.LAYOUT_COMPLETE;
    resource.layoutBox_ = {left: 11, top: 12, width: 111, height: 222};

    // Width changed.
    elementMock
      .expects('getBoundingClientRect')
      .returns({left: 11, top: 12, width: 111 + 10, height: 222})
      .once();
    elementMock.expects('isRelayoutNeeded').returns(true).atLeast(1);
    resource.measure();
    expect(resource.getState()).to.equal(ResourceState.READY_FOR_LAYOUT);
    expect(resource.getLayoutBox().width).to.equal(111 + 10);
  });

  it('should not relayout if element has not completed layout', () => {
    elementMock.expects('isUpgraded').returns(true).atLeast(1);
    resource.state_ = ResourceState.LAYOUT_SCHEDULED;
    resource.layoutBox_ = {left: 11, top: 12, width: 111, height: 222};

    // Width changed.
    elementMock
      .expects('getBoundingClientRect')
      .returns({left: 11, top: 12, width: 111 + 10, height: 222})
      .once();
    elementMock.expects('isRelayoutNeeded').returns(true).atLeast(0);
    resource.measure();
    expect(resource.getState()).to.equal(ResourceState.LAYOUT_SCHEDULED);
    expect(resource.getLayoutBox().width).to.equal(111 + 10);
  });

  it('should calculate NOT fixed for non-displayed elements', () => {
    elementMock.expects('isUpgraded').returns(true).atLeast(1);
    elementMock
      .expects('getBoundingClientRect')
      .returns(layoutRectLtwh(0, 0, 0, 0))
      .once();
    element.isAlwaysFixed = () => true;
    resource.measure();
    expect(resource.isFixed()).to.be.false;
  });

  it('should calculate fixed for always-fixed parent', () => {
    elementMock.expects('isUpgraded').returns(true).atLeast(1);
    elementMock
      .expects('getBoundingClientRect')
      .returns(layoutRectLtwh(0, 0, 10, 10))
      .once();
    const viewport = Services.viewportForDoc(resource.element);
    env.sandbox.stub(viewport, 'getScrollTop').returns(11);
    env.sandbox.defineProperty(element, 'offsetParent', {
      value: {
        isAlwaysFixed: () => true,
      },
    });
    resource.measure();
    expect(resource.isFixed()).to.be.true;
    expect(resource.getLayoutBox()).to.eql(layoutRectLtwh(0, 11, 10, 10));
  });

  it('should calculate fixed for fixed-style parent', () => {
    elementMock.expects('isUpgraded').returns(true).atLeast(1);
    elementMock
      .expects('getBoundingClientRect')
      .returns(layoutRectLtwh(0, 0, 10, 10))
      .once();

    const viewport = Services.viewportForDoc(resource.element);
    env.sandbox.stub(viewport, 'getScrollTop').returns(11);

    const fixedParent = doc.createElement('div');
    fixedParent.style.position = 'fixed';
    doc.body.appendChild(fixedParent);
    fixedParent.appendChild(element);
    env.sandbox.stub(viewport, 'isDeclaredFixed').callsFake((el) => {
      if (el == element) {
        return false;
      }
      if (el == fixedParent) {
        return true;
      }
    });
    resource.measure();
    expect(resource.isFixed()).to.be.true;
    expect(resource.getLayoutBox()).to.eql(layoutRectLtwh(0, 11, 10, 10));
  });

  describe('ensureMeasured', () => {
    it('should return layout box when the resource has NOT been measured', () => {
      env.sandbox.stub(element, 'isUpgraded').returns(true);
      env.sandbox
        .stub(element, 'getBoundingClientRect')
        .returns(layoutRectLtwh(0, 0, 10, 10));
      return resource.ensureMeasured();
    });

    it('should return layout box when the resource has been measured', () => {
      env.sandbox.stub(element, 'isUpgraded').returns(true);
      env.sandbox
        .stub(element, 'getBoundingClientRect')
        .returns(layoutRectLtwh(0, 0, 10, 10));
      resource.measure();
      return resource.ensureMeasured();
    });
  });

  describe('placeholder measure', () => {
    let rect;

    beforeEach(() => {
      element.setAttribute('placeholder', '');
      env.sandbox.defineProperty(element, 'parentElement', {
        value: doc.createElement('amp-iframe'),
        configurable: true,
        writable: true,
      });
      element.parentElement.__AMP__RESOURCE = {};
      elementMock.expects('isUpgraded').returns(true).atLeast(1);
      elementMock.expects('buildInternal').returns(Promise.resolve()).once();
      rect = {left: 11, top: 12, width: 111, height: 222};
      resource = new Resource(1, element, resources);
      return resource.build();
    });

    it('should measure placeholder with stubbed parent', () => {
      elementMock.expects('getBoundingClientRect').returns(rect).once();
      resource.measure();

      expect(resource.getState()).to.equal(ResourceState.READY_FOR_LAYOUT);
      expect(resource.hasBeenMeasured()).to.be.true;
    });

    it('should NOT measure placeholder with unstubbed parent', () => {
      // Parent is not stubbed yet, w/o __AMP__RESOURCE.
      delete element.parentElement.__AMP__RESOURCE;

      elementMock.expects('getBoundingClientRect').never();
      resource.measure();

      expect(resource.getState()).to.equal(ResourceState.NOT_LAID_OUT);
      expect(resource.hasBeenMeasured()).to.be.false;
    });

    it('should support abnormal case with no parent', () => {
      delete element.parentElement;

      elementMock.expects('getBoundingClientRect').returns(rect).once();
      resource.measure();

      expect(resource.getState()).to.equal(ResourceState.READY_FOR_LAYOUT);
      expect(resource.hasBeenMeasured()).to.be.true;
    });

    it('should support abnormal case with non-AMP parent', () => {
      element.parentElement = document.createElement('div');

      elementMock.expects('getBoundingClientRect').returns(rect).once();
      resource.measure();

      expect(resource.getState()).to.equal(ResourceState.READY_FOR_LAYOUT);
      expect(resource.hasBeenMeasured()).to.be.true;
    });
  });

  it('should hide and update layout box on collapse', () => {
    resource.layoutBox_ = {left: 11, top: 12, width: 111, height: 222};
    resource.isFixed_ = true;
    elementMock
      .expects('updateLayoutBox')
      .withExactArgs(
        env.sandbox.match((data) => {
          return data.width == 0 && data.height == 0;
        })
      )
      .once();
    const owner = {
      collapsedCallback: env.sandbox.spy(),
    };
    env.sandbox.stub(resource, 'getOwner').callsFake(() => {
      return owner;
    });
    resource.completeCollapse();
    expect(resource.element).to.have.attribute('hidden');
    expect(resource.getLayoutBox().width).to.equal(0);
    expect(resource.getLayoutBox().height).to.equal(0);
    expect(resource.isFixed()).to.be.false;
    expect(owner.collapsedCallback).to.be.calledOnce;
  });

  it('should show and request measure on expand', () => {
    resource.completeCollapse();
    resource.layoutBox_ = {left: 11, top: 12, width: 0, height: 0};
    resource.isFixed_ = false;
    resource.requestMeasure = env.sandbox.stub();

    resource.completeExpand();
    expect(resource.element).to.not.have.display('none');
    expect(resource.requestMeasure).to.be.calledOnce;
  });

  it('should ignore startLayout if already completed or failed or going', () => {
    elementMock.expects('layoutCallback').never();
    resource.layoutBox_ = {left: 11, top: 12, width: 10, height: 10};

    resource.state_ = ResourceState.LAYOUT_COMPLETE;
    resource.startLayout();

    resource.state_ = ResourceState.LAYOUT_FAILED;
    resource.startLayout();

    resource.state_ = ResourceState.READY_FOR_LAYOUT;
    allowConsoleError(() => {
      resource.startLayout();
    });

    resource.state_ = ResourceState.LAYOUT_SCHEDULED;
    resource.layoutPromise_ = {};
    resource.startLayout();
  });

  it('should fail startLayout if not built', () => {
    elementMock.expects('layoutCallback').never();

    resource.state_ = ResourceState.NOT_BUILT;
    allowConsoleError(() => {
      expect(() => {
        resource.startLayout();
      }).to.throw(/Not ready to start layout/);
    });
  });

  it('should ignore startLayout if not visible', () => {
    elementMock.expects('layoutCallback').never();
    resource.state_ = ResourceState.LAYOUT_SCHEDULED;
    resource.layoutBox_ = {left: 11, top: 12, width: 0, height: 0};
    allowConsoleError(() => {
      expect(() => {
        resource.startLayout();
      }).to.throw(/Not displayed/);
    });
  });

  it('should force startLayout for first layout', () => {
    elementMock.expects('layoutCallback').returns(Promise.resolve()).once();

    resource.state_ = ResourceState.LAYOUT_SCHEDULED;
    resource.layoutBox_ = {left: 11, top: 12, width: 10, height: 10};
    resource.startLayout();
    expect(resource.getState()).to.equal(ResourceState.LAYOUT_SCHEDULED);
  });

  it('should abort startLayout with unload', async () => {
    const neverEndingPromise = new Promise(() => {});
    elementMock.expects('layoutCallback').returns(neverEndingPromise).once();

    resource.state_ = ResourceState.LAYOUT_SCHEDULED;
    resource.layoutBox_ = {left: 11, top: 12, width: 10, height: 10};
    const layoutPromise = resource.startLayout();
    expect(resource.getState()).to.equal(ResourceState.LAYOUT_SCHEDULED);

    resource.unload();

    let error;
    try {
      await layoutPromise;
    } catch (e) {
      error = e;
    }
    expect(error).to.exist;
    expect(isCancellation(error)).to.be.true;
  });

  it('should ignore startLayout for re-layout when not opt-in', () => {
    elementMock.expects('layoutCallback').never();

    resource.state_ = ResourceState.LAYOUT_SCHEDULED;
    resource.layoutBox_ = {left: 11, top: 12, width: 10, height: 10};
    resource.layoutCount_ = 1;
    elementMock.expects('isRelayoutNeeded').returns(false).atLeast(1);
    resource.startLayout();
    expect(resource.getState()).to.equal(ResourceState.LAYOUT_COMPLETE);
  });

  it('should force startLayout for re-layout when opt-in', () => {
    elementMock.expects('layoutCallback').returns(Promise.resolve()).once();

    resource.state_ = ResourceState.LAYOUT_SCHEDULED;
    resource.layoutBox_ = {left: 11, top: 12, width: 10, height: 10};
    resource.layoutCount_ = 1;
    elementMock.expects('isRelayoutNeeded').returns(true).atLeast(1);
    resource.startLayout();
    expect(resource.getState()).to.equal(ResourceState.LAYOUT_SCHEDULED);
  });

  it('should complete startLayout', () => {
    elementMock.expects('layoutCallback').returns(Promise.resolve()).once();

    resource.state_ = ResourceState.LAYOUT_SCHEDULED;
    resource.layoutBox_ = {left: 11, top: 12, width: 10, height: 10};
    const loaded = resource.loadedOnce();
    const promise = resource.startLayout();
    expect(resource.layoutPromise_).to.not.equal(null);
    expect(resource.getState()).to.equal(ResourceState.LAYOUT_SCHEDULED);

    return promise.then(() => {
      expect(resource.getState()).to.equal(ResourceState.LAYOUT_COMPLETE);
      expect(resource.layoutPromise_).to.equal(null);
      return loaded; // Just making sure this doesn't time out.
    });
  });

  it('should complete startLayout with height == 0', () => {
    elementMock.expects('layoutCallback').returns(Promise.resolve()).once();
    elementMock.expects('getLayout').returns('fluid').once();

    resource.state_ = ResourceState.LAYOUT_SCHEDULED;
    resource.layoutBox_ = {left: 11, top: 12, width: 10, height: 0};
    const loaded = resource.loadedOnce();
    const promise = resource.startLayout();
    expect(resource.layoutPromise_).to.not.equal(null);
    expect(resource.getState()).to.equal(ResourceState.LAYOUT_SCHEDULED);

    return promise.then(() => {
      expect(resource.getState()).to.equal(ResourceState.LAYOUT_COMPLETE);
      expect(resource.layoutPromise_).to.equal(null);
      return loaded;
    });
  });

  it('should fail startLayout', () => {
    const error = new Error('intentional');
    elementMock.expects('layoutCallback').returns(Promise.reject(error)).once();

    resource.state_ = ResourceState.LAYOUT_SCHEDULED;
    resource.layoutBox_ = {left: 11, top: 12, width: 10, height: 10};
    const promise = resource.startLayout();
    expect(resource.layoutPromise_).to.not.equal(null);
    expect(resource.getState()).to.equal(ResourceState.LAYOUT_SCHEDULED);

    /* global fail: false */
    return promise
      .then(
        () => {
          fail('should not be here');
        },
        () => {
          expect(resource.getState()).to.equal(ResourceState.LAYOUT_FAILED);
          expect(resource.layoutPromise_).to.equal(null);
          expect(resource.lastLayoutError_).to.equal(error);

          // Should fail with the same error again.
          return resource.startLayout();
        }
      )
      .then(
        () => {
          fail('should not be here');
        },
        (reason) => {
          expect(reason).to.equal(error);
        }
      );
  });

  it('should record layout schedule time', () => {
    resource.layoutScheduled(300);
    expect(resource.element.layoutScheduleTime).to.equal(300);

    // The time should be updated if scheduled multiple times.
    resource.layoutScheduled(400);
    expect(resource.element.layoutScheduleTime).to.equal(400);

    expect(resource.getState()).to.equal(ResourceState.LAYOUT_SCHEDULED);
  });

  it('should not record layout schedule time in startLayout', () => {
    resource.state_ = ResourceState.LAYOUT_SCHEDULED;
    resource.layoutBox_ = {left: 11, top: 12, width: 10, height: 10};
    allowConsoleError(() => resource.startLayout());

    expect(resource.element.layoutScheduleTime).to.be.undefined;
    expect(resource.getState()).to.equal(ResourceState.LAYOUT_SCHEDULED);
  });

  it('should change size and update state', () => {
    expect(resource.isMeasureRequested()).to.be.false;
    resource.state_ = ResourceState.READY_FOR_LAYOUT;
    elementMock
      .expects('applySize')
      .withExactArgs(111, 222, {top: 1, right: 2, bottom: 3, left: 4})
      .once();
    resource.changeSize(111, 222, {top: 1, right: 2, bottom: 3, left: 4});
    expect(resource.isMeasureRequested()).to.be.true;
  });

  it('should change size but not state', () => {
    resource.state_ = ResourceState.NOT_BUILT;
    elementMock
      .expects('applySize')
      .withExactArgs(111, 222, {top: 1, right: 2, bottom: 3, left: 4})
      .once();
    resource.changeSize(111, 222, {top: 1, right: 2, bottom: 3, left: 4});
    expect(resource.getState()).to.equal(ResourceState.NOT_BUILT);
  });

  it('should update priority', () => {
    expect(resource.getLayoutPriority()).to.equal(LayoutPriority.ADS);

    resource.updateLayoutPriority(LayoutPriority.ADS);
    expect(resource.getLayoutPriority()).to.equal(LayoutPriority.ADS);

    resource.updateLayoutPriority(LayoutPriority.BACKGROUND);
    expect(resource.getLayoutPriority()).to.equal(LayoutPriority.BACKGROUND);

    resource.updateLayoutPriority(LayoutPriority.METADATA);
    expect(resource.getLayoutPriority()).to.equal(LayoutPriority.METADATA);

    resource.updateLayoutPriority(LayoutPriority.CONTENT);
    expect(resource.getLayoutPriority()).to.equal(LayoutPriority.CONTENT);
  });

  describe('setInViewport', () => {
    let resolveWithinViewportSpy;
    beforeEach(
      () =>
        (resolveWithinViewportSpy = env.sandbox.spy(
          resource,
          'resolveDeferredsWhenWithinViewports_'
        ))
    );

    it('should set inViewport to true', () => {
      resource.setInViewport(true);
      expect(resource.isInViewport()).to.equal(true);
      expect(resolveWithinViewportSpy).to.be.calledOnce;
    });
  });

  describe('Resource set/get ownership', () => {
    let child;
    let parentResource;
    let owners;
    let resources;
    let grandChild;
    beforeEach(() => {
      const parent = {
        ownerDocument: {defaultView: window},
        tagName: 'PARENT',
        hasAttribute: () => false,
        isBuilt: () => false,
        isBuilding: () => false,
        contains: () => true,
      };
      child = {
        ownerDocument: {defaultView: window},
        tagName: 'CHILD',
        hasAttribute: () => false,
        isBuilt: () => false,
        isBuilding: () => false,
        contains: () => true,
        parentElement: parent,
      };
      grandChild = {
        ownerDocument: {defaultView: window},
        tagName: 'GRANDCHILD',
        hasAttribute: () => false,
        isBuilt: () => false,
        isBuilding: () => false,
        contains: () => true,
        getElementsByClassName: () => {
          return [];
        },
        parentElement: child,
      };
      parent.getElementsByClassName = () => {
        return [child, grandChild];
      };
      child.getElementsByClassName = () => {
        return [grandChild];
      };
      const ampdoc = new AmpDocSingle(window);
      resources = new ResourcesImpl(ampdoc);
      owners = new OwnersImpl(ampdoc);
      parentResource = new Resource(1, parent, resources);
    });

    it('should set resource before Resource created for child element', () => {
      owners.setOwner(child, parentResource.element);
      const childResource = new Resource(1, child, resources);
      expect(childResource.getOwner()).to.equal(parentResource.element);
    });

    it('should always get the lastest owner value', () => {
      const childResource = new Resource(1, child, resources);
      expect(childResource.getOwner()).to.be.null;
      owners.setOwner(childResource.element, parentResource.element);
      expect(childResource.owner_).to.equal(parentResource.element);
      expect(childResource.getOwner()).to.equal(parentResource.element);
    });

    it('should remove cached value for grandchild', () => {
      const childResource = new Resource(1, child, resources);
      const grandChildResource = new Resource(1, grandChild, resources);
      expect(grandChildResource.getOwner()).to.be.null;
      owners.setOwner(childResource.element, parentResource.element);
      expect(childResource.getOwner()).to.equal(parentResource.element);
      expect(grandChildResource.getOwner()).to.equal(parentResource.element);
    });

    it('should not change owner if it is set via setOwner', () => {
      const childResource = new Resource(1, child, resources);
      const grandChildResource = new Resource(1, grandChild, resources);
      owners.setOwner(grandChildResource.element, parentResource.element);
      expect(grandChildResource.getOwner()).to.equal(parentResource.element);
      owners.setOwner(childResource.element, parentResource.element);
      expect(grandChildResource.getOwner()).to.equal(parentResource.element);
    });
  });

  describe('unlayoutCallback', () => {
    it('should NOT call unlayoutCallback on unbuilt element', () => {
      resource.state_ = ResourceState.NOT_BUILT;
      elementMock.expects('unlayoutCallback').never();
      resource.unlayout();
      expect(resource.getState()).to.equal(ResourceState.NOT_BUILT);
    });

    it('should call unlayoutCallback on built element and update state', () => {
      resource.state_ = ResourceState.LAYOUT_COMPLETE;
      elementMock.expects('unlayoutCallback').returns(true).once();
      elementMock.expects('togglePlaceholder').withArgs(true).once();
      resource.unlayout();
      expect(resource.getState()).to.equal(ResourceState.NOT_LAID_OUT);
    });

    it('updated state should bypass isRelayoutNeeded', () => {
      resource.state_ = ResourceState.LAYOUT_COMPLETE;
      elementMock.expects('unlayoutCallback').returns(true).once();
      elementMock.expects('togglePlaceholder').withArgs(true).once();
      elementMock.expects('isUpgraded').returns(true).atLeast(1);
      elementMock
        .expects('getBoundingClientRect')
        .returns({left: 1, top: 1, width: 1, height: 1})
        .once();

      resource.unlayout();

      resource.state_ = ResourceState.LAYOUT_SCHEDULED;
      elementMock.expects('layoutCallback').returns(Promise.resolve()).once();
      resource.measure();
      resource.startLayout();
    });

    it('should call unlayoutCallback on built element but NOT update state', () => {
      resource.state_ = ResourceState.LAYOUT_COMPLETE;
      elementMock.expects('unlayoutCallback').returns(false).once();
      elementMock.expects('togglePlaceholder').withArgs(true).never();
      resource.unlayout();
      expect(resource.getState()).to.equal(ResourceState.LAYOUT_COMPLETE);
    });

    it('should delegate unload to unlayoutCallback', () => {
      resource.state_ = ResourceState.LAYOUT_COMPLETE;
      elementMock.expects('unlayoutCallback').returns(false).once();
      elementMock.expects('togglePlaceholder').withArgs(true).never();
      resource.unload();
      expect(resource.getState()).to.equal(ResourceState.LAYOUT_COMPLETE);
    });
  });

  describe('pause', () => {
    it('should call pause on unbuilt element', () => {
      resource.state_ = ResourceState.NOT_BUILT;
      elementMock.expects('pause').once();
      resource.pause();
    });

    it('should call pause on built element', () => {
      resource.state_ = ResourceState.LAYOUT_COMPLETE;
      elementMock.expects('pause').once();
      resource.pause();
    });

    it('should NOT call unlayoutCallback', () => {
      resource.state_ = ResourceState.LAYOUT_COMPLETE;
      elementMock.expects('pause').once();
      elementMock.expects('unlayoutCallback').never();
      resource.pause();
    });

    describe('when remove from DOM', () => {
      it('should call pause on remove for unbuilt ele', () => {
        resource.state_ = ResourceState.NOT_BUILT;
        elementMock.expects('pause').once();
        resource.pauseOnRemove();
      });

      it('should call pause on remove for built ele', () => {
        resource.state_ = ResourceState.LAYOUT_COMPLETE;
        elementMock.expects('pause').once();
        resource.pauseOnRemove();
      });
    });

    // TODO(jridgewell): unskip the tests. This fails when run alone.
    describe.skip('manual disconnect', () => {
      beforeEach(() => {
        element.setAttribute('layout', 'nodisplay');
        doc.body.appendChild(element);
        resource = Resource.forElementOptional(element);
        resources = element.getResources();
      });

      it('should call disconnect on remove for built ele', () => {
        env.sandbox.stub(element, 'isConnected').value(false);
        const remove = env.sandbox.spy(resources, 'remove');
        resource.disconnect();
        expect(remove).to.have.been.called;
        expect(Resource.forElementOptional(resource.element)).to.not.exist;
      });

      it('should call disconnected regardless of isConnected', () => {
        // element is already connected to DOM
        const spy = env.sandbox.spy(resources, 'remove');
        resource.disconnect();
        expect(spy).to.have.been.called;
        expect(Resource.forElementOptional(resource.element)).to.not.exist;
      });
    });
  });

  describe('resume', () => {
    it('should call resume on unbuilt element', () => {
      resource.state_ = ResourceState.NOT_BUILT;
      elementMock.expects('resume').once();
      resource.resume();
    });

    it('should call resume on un-paused element', () => {
      resource.state_ = ResourceState.LAYOUT_COMPLETE;
      elementMock.expects('resume').once();
      resource.resume();
    });
  });
});

describes.sandboxed('Resource idleRenderOutsideViewport', {}, (env) => {
  let element;
  let resources;
  let resource;
  let idleRenderOutsideViewport;
  let isWithinViewportRatio;

  beforeEach(() => {
    idleRenderOutsideViewport = env.sandbox.stub();
    element = {
      idleRenderOutsideViewport,
      ownerDocument: {defaultView: window},
      tagName: 'AMP-AD',
      hasAttribute: () => false,
      isBuilt: () => false,
      isBuilding: () => false,
      isUpgraded: () => false,
      prerenderAllowed: () => false,
      renderOutsideViewport: () => true,
      build: () => false,
      getBoundingClientRect: () => null,
      updateLayoutBox: () => {},
      isRelayoutNeeded: () => false,
      layoutCallback: () => {},
      applySize: () => {},
      unlayoutOnPause: () => false,
      unlayoutCallback: () => true,
      pause: () => false,
      resume: () => false,
      getLayoutPriority: () => LayoutPriority.CONTENT,
    };
    resources = new ResourcesImpl(new AmpDocSingle(window));
    resource = new Resource(1, element, resources);
    isWithinViewportRatio = env.sandbox.stub(resource, 'isWithinViewportRatio');
  });

  it('should return true if isWithinViewportRatio', () => {
    idleRenderOutsideViewport.returns(5);
    isWithinViewportRatio.withArgs(5).returns(true);
    expect(resource.idleRenderOutsideViewport()).to.equal(true);
  });

  it('should return false for false element idleRenderOutsideViewport', () => {
    idleRenderOutsideViewport.returns(false);
    isWithinViewportRatio.withArgs(false).returns(false);
    expect(resource.idleRenderOutsideViewport()).to.equal(false);
  });
});

describes.realWin('Resource renderOutsideViewport', {amp: true}, (env) => {
  let element;
  let resources;
  let resource;
  let viewport;
  let renderOutsideViewport;
  let resolveWithinViewportSpy;

  beforeEach(() => {
    element = env.createAmpElement('amp-fake-element');
    env.win.document.body.appendChild(element);

    resources = new ResourcesImpl(env.ampdoc);
    resource = new Resource(1, element, resources);
    viewport = Services.viewportForDoc(env.ampdoc);
    renderOutsideViewport = env.sandbox.stub(element, 'renderOutsideViewport');
    env.sandbox
      .stub(viewport, 'getRect')
      .returns(layoutRectLtwh(0, 0, 100, 100));
    resolveWithinViewportSpy = env.sandbox.spy(
      resource,
      'resolveDeferredsWhenWithinViewports_'
    );
  });

  describe('boolean API', () => {
    describe('when element returns true', () => {
      beforeEach(() => {
        renderOutsideViewport.returns(true);
      });

      describe('when element is inside viewport', () => {
        it('should allow rendering when bottom falls outside', () => {
          resource.layoutBox_ = layoutRectLtwh(0, 10, 100, 100);
          expect(resource.renderOutsideViewport()).to.equal(true);
          expect(resolveWithinViewportSpy).to.be.calledOnce;
        });

        it('should allow rendering when top falls outside', () => {
          resource.layoutBox_ = layoutRectLtwh(0, -10, 100, 100);
          expect(resource.renderOutsideViewport()).to.equal(true);
          expect(resolveWithinViewportSpy).to.be.calledOnce;
        });

        describe('when element is owned', () => {
          beforeEach(() => {
            env.sandbox.stub(resource, 'hasOwner').callsFake(() => true);
          });

          it('should allow rendering when bottom falls outside', () => {
            resource.layoutBox_ = layoutRectLtwh(0, 10, 100, 100);
            expect(resource.renderOutsideViewport()).to.equal(true);
            expect(resolveWithinViewportSpy).to.be.calledOnce;
          });

          it('should allow rendering when top falls outside', () => {
            resource.layoutBox_ = layoutRectLtwh(0, -10, 100, 100);
            expect(resource.renderOutsideViewport()).to.equal(true);
            expect(resolveWithinViewportSpy).to.be.calledOnce;
          });
        });
      });

      describe('when element is just below viewport', () => {
        beforeEach(() => {
          resource.layoutBox_ = layoutRectLtwh(0, 110, 100, 100);
        });

        it('should allow rendering when scrolling towards', () => {
          resources.lastVelocity_ = 2;
          expect(resource.renderOutsideViewport()).to.equal(true);
          expect(resolveWithinViewportSpy).to.be.calledOnce;
        });

        it('should allow rendering when scrolling away', () => {
          resources.lastVelocity_ = -2;
          expect(resource.renderOutsideViewport()).to.equal(true);
          expect(resolveWithinViewportSpy).to.be.calledOnce;
        });

        describe('when element is owned', () => {
          beforeEach(() => {
            env.sandbox.stub(resource, 'hasOwner').callsFake(() => true);
          });

          it('should allow rendering when scrolling towards', () => {
            resources.lastVelocity_ = 2;
            expect(resource.renderOutsideViewport()).to.equal(true);
            expect(resolveWithinViewportSpy).to.be.calledOnce;
          });

          it('should allow rendering when scrolling away', () => {
            resources.lastVelocity_ = -2;
            expect(resource.renderOutsideViewport()).to.equal(true);
            expect(resolveWithinViewportSpy).to.be.calledOnce;
          });
        });
      });

      describe('when element is marginally below viewport', () => {
        beforeEach(() => {
          resource.layoutBox_ = layoutRectLtwh(0, 250, 100, 100);
        });

        it('should allow rendering when scrolling towards', () => {
          resources.lastVelocity_ = 2;
          expect(resource.renderOutsideViewport()).to.equal(true);
          expect(resolveWithinViewportSpy).to.be.calledOnce;
        });

        it('should allow rendering when scrolling away', () => {
          resources.lastVelocity_ = -2;
          expect(resource.renderOutsideViewport()).to.equal(true);
          expect(resolveWithinViewportSpy).to.be.calledOnce;
        });

        describe('when element is owned', () => {
          beforeEach(() => {
            env.sandbox.stub(resource, 'hasOwner').callsFake(() => true);
          });

          it('should allow rendering when scrolling towards', () => {
            resources.lastVelocity_ = 2;
            expect(resource.renderOutsideViewport()).to.equal(true);
            expect(resolveWithinViewportSpy).to.be.calledOnce;
          });

          it('should allow rendering when scrolling away', () => {
            resources.lastVelocity_ = -2;
            expect(resource.renderOutsideViewport()).to.equal(true);
            expect(resolveWithinViewportSpy).to.be.calledOnce;
          });
        });
      });

      describe('when element is wayyy below viewport', () => {
        beforeEach(() => {
          resource.layoutBox_ = layoutRectLtwh(0, 1000, 100, 100);
        });

        it('should allow rendering', () => {
          expect(resource.renderOutsideViewport()).to.equal(true);
          expect(resolveWithinViewportSpy).to.be.calledOnce;
        });

        it('should allow rendering when scrolling towards', () => {
          resources.lastVelocity_ = 2;
          expect(resource.renderOutsideViewport()).to.equal(true);
          expect(resolveWithinViewportSpy).to.be.calledOnce;
        });

        it('should allow rendering when scrolling away', () => {
          resources.lastVelocity_ = -2;
          expect(resource.renderOutsideViewport()).to.equal(true);
          expect(resolveWithinViewportSpy).to.be.calledOnce;
        });

        describe('when element is owned', () => {
          beforeEach(() => {
            env.sandbox.stub(resource, 'hasOwner').callsFake(() => true);
          });

          it('should allow rendering', () => {
            expect(resource.renderOutsideViewport()).to.equal(true);
            expect(resolveWithinViewportSpy).to.be.calledOnce;
          });

          it('should allow rendering when scrolling towards', () => {
            resources.lastVelocity_ = 2;
            expect(resource.renderOutsideViewport()).to.equal(true);
            expect(resolveWithinViewportSpy).to.be.calledOnce;
          });

          it('should allow rendering when scrolling away', () => {
            resources.lastVelocity_ = -2;
            expect(resource.renderOutsideViewport()).to.equal(true);
            expect(resolveWithinViewportSpy).to.be.calledOnce;
          });
        });
      });

      describe('when element is just above viewport', () => {
        beforeEach(() => {
          resource.layoutBox_ = layoutRectLtwh(0, -10, 100, 100);
        });

        it('should allow rendering when scrolling towards', () => {
          resources.lastVelocity_ = -2;
          expect(resource.renderOutsideViewport()).to.equal(true);
          expect(resolveWithinViewportSpy).to.be.calledOnce;
        });

        it('should allow rendering when scrolling away', () => {
          resources.lastVelocity_ = 2;
          expect(resource.renderOutsideViewport()).to.equal(true);
          expect(resolveWithinViewportSpy).to.be.calledOnce;
        });

        describe('when element is owned', () => {
          beforeEach(() => {
            env.sandbox.stub(resource, 'hasOwner').callsFake(() => true);
          });

          it('should allow rendering when scrolling towards', () => {
            resources.lastVelocity_ = -2;
            expect(resource.renderOutsideViewport()).to.equal(true);
            expect(resolveWithinViewportSpy).to.be.calledOnce;
          });

          it('should allow rendering when scrolling away', () => {
            resources.lastVelocity_ = 2;
            expect(resource.renderOutsideViewport()).to.equal(true);
            expect(resolveWithinViewportSpy).to.be.calledOnce;
          });
        });
      });

      describe('when element is marginally above viewport', () => {
        beforeEach(() => {
          resource.layoutBox_ = layoutRectLtwh(0, -250, 100, 100);
        });

        it('should allow rendering when scrolling towards', () => {
          resources.lastVelocity_ = -2;
          expect(resource.renderOutsideViewport()).to.equal(true);
          expect(resolveWithinViewportSpy).to.be.calledOnce;
        });

        it('should allow rendering when scrolling away', () => {
          resources.lastVelocity_ = 2;
          expect(resource.renderOutsideViewport()).to.equal(true);
          expect(resolveWithinViewportSpy).to.be.calledOnce;
        });

        describe('when element is owned', () => {
          beforeEach(() => {
            env.sandbox.stub(resource, 'hasOwner').callsFake(() => true);
          });

          it('should allow rendering when scrolling towards', () => {
            resources.lastVelocity_ = -2;
            expect(resource.renderOutsideViewport()).to.equal(true);
            expect(resolveWithinViewportSpy).to.be.calledOnce;
          });

          it('should allow rendering when scrolling away', () => {
            resources.lastVelocity_ = 2;
            expect(resource.renderOutsideViewport()).to.equal(true);
            expect(resolveWithinViewportSpy).to.be.calledOnce;
          });
        });
      });

      describe('when element is wayyy above viewport', () => {
        beforeEach(() => {
          resource.layoutBox_ = layoutRectLtwh(0, -1000, 100, 100);
        });

        it('should allow rendering', () => {
          expect(resource.renderOutsideViewport()).to.equal(true);
          expect(resolveWithinViewportSpy).to.be.calledOnce;
        });

        it('should allow rendering when scrolling towards', () => {
          resources.lastVelocity_ = -2;
          expect(resource.renderOutsideViewport()).to.equal(true);
          expect(resolveWithinViewportSpy).to.be.calledOnce;
        });

        it('should allow rendering when scrolling away', () => {
          resources.lastVelocity_ = 2;
          expect(resource.renderOutsideViewport()).to.equal(true);
          expect(resolveWithinViewportSpy).to.be.calledOnce;
        });

        describe('when element is owned', () => {
          beforeEach(() => {
            env.sandbox.stub(resource, 'hasOwner').callsFake(() => true);
          });

          it('should allow rendering', () => {
            expect(resource.renderOutsideViewport()).to.equal(true);
            expect(resolveWithinViewportSpy).to.be.calledOnce;
          });

          it('should allow rendering when scrolling towards', () => {
            resources.lastVelocity_ = -2;
            expect(resource.renderOutsideViewport()).to.equal(true);
            expect(resolveWithinViewportSpy).to.be.calledOnce;
          });

          it('should allow rendering when scrolling away', () => {
            resources.lastVelocity_ = 2;
            expect(resource.renderOutsideViewport()).to.equal(true);
            expect(resolveWithinViewportSpy).to.be.calledOnce;
          });
        });
      });
    });

    describe('when element returns false', () => {
      beforeEach(() => {
        renderOutsideViewport.returns(false);
      });

      describe('when element is inside viewport', () => {
        it('should allow rendering when bottom falls outside', () => {
          resource.layoutBox_ = layoutRectLtwh(0, 10, 100, 100);
          expect(resource.renderOutsideViewport()).to.equal(false);
          expect(resolveWithinViewportSpy).to.be.called;
        });

        it('should allow rendering when top falls outside', () => {
          resource.layoutBox_ = layoutRectLtwh(0, -10, 100, 100);
          expect(resource.renderOutsideViewport()).to.equal(false);
          expect(resolveWithinViewportSpy).to.be.called;
        });

        describe('when element is owned', () => {
          beforeEach(() => {
            env.sandbox.stub(resource, 'hasOwner').callsFake(() => true);
          });

          it('should allow rendering when bottom falls outside', () => {
            resource.layoutBox_ = layoutRectLtwh(0, 10, 100, 100);
            expect(resource.renderOutsideViewport()).to.equal(true);
            expect(resolveWithinViewportSpy).to.be.calledOnce;
          });

          it('should allow rendering when top falls outside', () => {
            resource.layoutBox_ = layoutRectLtwh(0, -10, 100, 100);
            expect(resource.renderOutsideViewport()).to.equal(true);
            expect(resolveWithinViewportSpy).to.be.calledOnce;
          });
        });
      });

      describe('when element is just below viewport', () => {
        beforeEach(() => {
          resource.layoutBox_ = layoutRectLtwh(0, 110, 100, 100);
        });

        it('should disallow rendering when scrolling towards', () => {
          resources.lastVelocity_ = 2;
          expect(resource.renderOutsideViewport()).to.equal(false);
          expect(resolveWithinViewportSpy).to.be.called;
        });

        it('should disallow rendering when scrolling away', () => {
          resources.lastVelocity_ = -2;
          expect(resource.renderOutsideViewport()).to.equal(false);
          expect(resolveWithinViewportSpy).to.be.called;
        });

        describe('when element is owned', () => {
          beforeEach(() => {
            env.sandbox.stub(resource, 'hasOwner').callsFake(() => true);
          });

          it('should allow rendering when scrolling towards', () => {
            resources.lastVelocity_ = 2;
            expect(resource.renderOutsideViewport()).to.equal(true);
            expect(resolveWithinViewportSpy).to.be.calledOnce;
          });

          it('should allow rendering when scrolling away', () => {
            resources.lastVelocity_ = -2;
            expect(resource.renderOutsideViewport()).to.equal(true);
            expect(resolveWithinViewportSpy).to.be.calledOnce;
          });
        });
      });

      describe('when element is marginally below viewport', () => {
        beforeEach(() => {
          resource.layoutBox_ = layoutRectLtwh(0, 250, 100, 100);
        });

        it('should disallow rendering when scrolling towards', () => {
          resources.lastVelocity_ = 2;
          expect(resource.renderOutsideViewport()).to.equal(false);
          expect(resolveWithinViewportSpy).to.be.called;
        });

        it('should disallow rendering when scrolling away', () => {
          resources.lastVelocity_ = -2;
          expect(resource.renderOutsideViewport()).to.equal(false);
          expect(resolveWithinViewportSpy).to.be.called;
        });

        describe('when element is owned', () => {
          beforeEach(() => {
            env.sandbox.stub(resource, 'hasOwner').callsFake(() => true);
          });

          it('should allow rendering when scrolling towards', () => {
            resources.lastVelocity_ = 2;
            expect(resource.renderOutsideViewport()).to.equal(true);
            expect(resolveWithinViewportSpy).to.be.calledOnce;
          });

          it('should allow rendering when scrolling away', () => {
            resources.lastVelocity_ = -2;
            expect(resource.renderOutsideViewport()).to.equal(true);
            expect(resolveWithinViewportSpy).to.be.calledOnce;
          });
        });
      });

      describe('when element is wayyy below viewport', () => {
        beforeEach(() => {
          resource.layoutBox_ = layoutRectLtwh(0, 1000, 100, 100);
        });

        it('should disallow rendering', () => {
          expect(resource.renderOutsideViewport()).to.equal(false);
          expect(resolveWithinViewportSpy).to.be.called;
        });

        it('should disallow rendering when scrolling towards', () => {
          resources.lastVelocity_ = 2;
          expect(resource.renderOutsideViewport()).to.equal(false);
          expect(resolveWithinViewportSpy).to.be.called;
        });

        it('should disallow rendering when scrolling away', () => {
          resources.lastVelocity_ = -2;
          expect(resource.renderOutsideViewport()).to.equal(false);
          expect(resolveWithinViewportSpy).to.be.called;
        });

        describe('when element is owned', () => {
          beforeEach(() => {
            env.sandbox.stub(resource, 'hasOwner').callsFake(() => true);
          });

          it('should allow rendering', () => {
            expect(resource.renderOutsideViewport()).to.equal(true);
            expect(resolveWithinViewportSpy).to.be.calledOnce;
          });

          it('should allow rendering when scrolling towards', () => {
            resources.lastVelocity_ = 2;
            expect(resource.renderOutsideViewport()).to.equal(true);
            expect(resolveWithinViewportSpy).to.be.calledOnce;
          });

          it('should allow rendering when scrolling away', () => {
            resources.lastVelocity_ = -2;
            expect(resource.renderOutsideViewport()).to.equal(true);
            expect(resolveWithinViewportSpy).to.be.calledOnce;
          });
        });
      });

      describe('when element is just above viewport', () => {
        beforeEach(() => {
          resource.layoutBox_ = layoutRectLtwh(0, -10, 100, 100);
        });

        it('should disallow rendering when scrolling towards', () => {
          resources.lastVelocity_ = -2;
          expect(resource.renderOutsideViewport()).to.equal(false);
          expect(resolveWithinViewportSpy).to.be.called;
        });

        it('should disallow rendering when scrolling away', () => {
          resources.lastVelocity_ = 2;
          expect(resource.renderOutsideViewport()).to.equal(false);
          expect(resolveWithinViewportSpy).to.be.called;
        });

        describe('when element is owned', () => {
          beforeEach(() => {
            env.sandbox.stub(resource, 'hasOwner').callsFake(() => true);
          });

          it('should allow rendering when scrolling towards', () => {
            resources.lastVelocity_ = -2;
            expect(resource.renderOutsideViewport()).to.equal(true);
            expect(resolveWithinViewportSpy).to.be.calledOnce;
          });

          it('should allow rendering when scrolling away', () => {
            resources.lastVelocity_ = 2;
            expect(resource.renderOutsideViewport()).to.equal(true);
            expect(resolveWithinViewportSpy).to.be.calledOnce;
          });
        });
      });

      describe('when element is marginally above viewport', () => {
        beforeEach(() => {
          resource.layoutBox_ = layoutRectLtwh(0, -250, 100, 100);
        });

        it('should disallow rendering when scrolling towards', () => {
          resources.lastVelocity_ = -2;
          expect(resource.renderOutsideViewport()).to.equal(false);
          expect(resolveWithinViewportSpy).to.be.called;
        });

        it('should disallow rendering when scrolling away', () => {
          resources.lastVelocity_ = 2;
          expect(resource.renderOutsideViewport()).to.equal(false);
          expect(resolveWithinViewportSpy).to.be.called;
        });

        describe('when element is owned', () => {
          beforeEach(() => {
            env.sandbox.stub(resource, 'hasOwner').callsFake(() => true);
          });

          it('should allow rendering when scrolling towards', () => {
            resources.lastVelocity_ = -2;
            expect(resource.renderOutsideViewport()).to.equal(true);
            expect(resolveWithinViewportSpy).to.be.calledOnce;
          });

          it('should allow rendering when scrolling away', () => {
            resources.lastVelocity_ = 2;
            expect(resource.renderOutsideViewport()).to.equal(true);
            expect(resolveWithinViewportSpy).to.be.calledOnce;
          });
        });
      });

      describe('when element is wayyy above viewport', () => {
        beforeEach(() => {
          resource.layoutBox_ = layoutRectLtwh(0, -1000, 100, 100);
        });

        it('should disallow rendering', () => {
          expect(resource.renderOutsideViewport()).to.equal(false);
          expect(resolveWithinViewportSpy).to.be.called;
        });

        it('should disallow rendering when scrolling towards', () => {
          resources.lastVelocity_ = -2;
          expect(resource.renderOutsideViewport()).to.equal(false);
          expect(resolveWithinViewportSpy).to.be.called;
        });

        it('should disallow rendering when scrolling away', () => {
          resources.lastVelocity_ = 2;
          expect(resource.renderOutsideViewport()).to.equal(false);
          expect(resolveWithinViewportSpy).to.be.called;
        });

        describe('when element is owned', () => {
          beforeEach(() => {
            env.sandbox.stub(resource, 'hasOwner').callsFake(() => true);
          });

          it('should allow rendering', () => {
            expect(resource.renderOutsideViewport()).to.equal(true);
            expect(resolveWithinViewportSpy).to.be.calledOnce;
          });

          it('should allow rendering when scrolling towards', () => {
            resources.lastVelocity_ = -2;
            expect(resource.renderOutsideViewport()).to.equal(true);
            expect(resolveWithinViewportSpy).to.be.calledOnce;
          });

          it('should allow rendering when scrolling away', () => {
            resources.lastVelocity_ = 2;
            expect(resource.renderOutsideViewport()).to.equal(true);
            expect(resolveWithinViewportSpy).to.be.calledOnce;
          });
        });
      });
    });
  });

  describe('number API', () => {
    beforeEach(() => {
      renderOutsideViewport.returns(3);
    });

    describe('when element is inside viewport', () => {
      it('should allow rendering when bottom falls outside', () => {
        resource.layoutBox_ = layoutRectLtwh(0, 10, 100, 100);
        expect(resource.renderOutsideViewport()).to.equal(true);
        expect(resolveWithinViewportSpy).to.be.calledOnce;
      });

      it('should allow rendering when top falls outside', () => {
        resource.layoutBox_ = layoutRectLtwh(0, -10, 100, 100);
        expect(resource.renderOutsideViewport()).to.equal(true);
        expect(resolveWithinViewportSpy).to.be.calledOnce;
      });

      describe('when element is owned', () => {
        beforeEach(() => {
          env.sandbox.stub(resource, 'hasOwner').callsFake(() => true);
        });

        it('should allow rendering when bottom falls outside', () => {
          resource.layoutBox_ = layoutRectLtwh(0, 10, 100, 100);
          expect(resource.renderOutsideViewport()).to.equal(true);
          expect(resolveWithinViewportSpy).to.be.calledOnce;
        });

        it('should allow rendering when top falls outside', () => {
          resource.layoutBox_ = layoutRectLtwh(0, -10, 100, 100);
          expect(resource.renderOutsideViewport()).to.equal(true);
          expect(resolveWithinViewportSpy).to.be.calledOnce;
        });
      });
    });

    describe('when element is just below viewport', () => {
      beforeEach(() => {
        resource.layoutBox_ = layoutRectLtwh(0, 110, 100, 100);
      });

      it('should allow rendering when scrolling towards', () => {
        resources.lastVelocity_ = 2;
        expect(resource.renderOutsideViewport()).to.equal(true);
        expect(resolveWithinViewportSpy).to.be.calledOnce;
      });

      it('should allow rendering when scrolling away', () => {
        resources.lastVelocity_ = -2;
        expect(resource.renderOutsideViewport()).to.equal(true);
        expect(resolveWithinViewportSpy).to.be.calledOnce;
      });

      describe('when element is owned', () => {
        beforeEach(() => {
          env.sandbox.stub(resource, 'hasOwner').callsFake(() => true);
        });

        it('should allow rendering when scrolling towards', () => {
          resources.lastVelocity_ = 2;
          expect(resource.renderOutsideViewport()).to.equal(true);
          expect(resolveWithinViewportSpy).to.be.calledOnce;
        });

        it('should allow rendering when scrolling away', () => {
          resources.lastVelocity_ = -2;
          expect(resource.renderOutsideViewport()).to.equal(true);
          expect(resolveWithinViewportSpy).to.be.calledOnce;
        });
      });
    });

    describe('when element is marginally below viewport', () => {
      beforeEach(() => {
        resource.layoutBox_ = layoutRectLtwh(0, 250, 100, 100);
      });

      it('should allow rendering when scrolling towards', () => {
        resources.lastVelocity_ = 2;
        expect(resource.renderOutsideViewport()).to.equal(true);
        expect(resolveWithinViewportSpy).to.be.calledOnce;
      });

      it('should disallow rendering when scrolling away', () => {
        resources.lastVelocity_ = -2;
        expect(resource.renderOutsideViewport()).to.equal(false);
        expect(resolveWithinViewportSpy).to.be.called;
      });

      describe('when element is owned', () => {
        beforeEach(() => {
          env.sandbox.stub(resource, 'hasOwner').callsFake(() => true);
        });

        it('should allow rendering when scrolling towards', () => {
          resources.lastVelocity_ = 2;
          expect(resource.renderOutsideViewport()).to.equal(true);
          expect(resolveWithinViewportSpy).to.be.calledOnce;
        });

        it('should allow rendering when scrolling away', () => {
          resources.lastVelocity_ = -2;
          expect(resource.renderOutsideViewport()).to.equal(true);
          expect(resolveWithinViewportSpy).to.be.calledOnce;
        });
      });
    });

    describe('when element is wayyy below viewport', () => {
      beforeEach(() => {
        resource.layoutBox_ = layoutRectLtwh(0, 1000, 100, 100);
      });

      it('should disallow rendering', () => {
        expect(resource.renderOutsideViewport()).to.equal(false);
        expect(resolveWithinViewportSpy).to.be.called;
      });

      it('should disallow rendering when scrolling towards', () => {
        resources.lastVelocity_ = 2;
        expect(resource.renderOutsideViewport()).to.equal(false);
        expect(resolveWithinViewportSpy).to.be.called;
      });

      it('should disallow rendering when scrolling away', () => {
        resources.lastVelocity_ = -2;
        expect(resource.renderOutsideViewport()).to.equal(false);
        expect(resolveWithinViewportSpy).to.be.called;
      });

      describe('when element is owned', () => {
        beforeEach(() => {
          env.sandbox.stub(resource, 'hasOwner').callsFake(() => true);
        });

        it('should allow rendering', () => {
          expect(resource.renderOutsideViewport()).to.equal(true);
          expect(resolveWithinViewportSpy).to.be.calledOnce;
        });

        it('should allow rendering when scrolling towards', () => {
          resources.lastVelocity_ = 2;
          expect(resource.renderOutsideViewport()).to.equal(true);
          expect(resolveWithinViewportSpy).to.be.calledOnce;
        });

        it('should allow rendering when scrolling away', () => {
          resources.lastVelocity_ = -2;
          expect(resource.renderOutsideViewport()).to.equal(true);
          expect(resolveWithinViewportSpy).to.be.calledOnce;
        });
      });
    });

    describe('when element is just above viewport', () => {
      beforeEach(() => {
        resource.layoutBox_ = layoutRectLtwh(0, -10, 100, 100);
      });

      it('should allow rendering when scrolling towards', () => {
        resources.lastVelocity_ = -2;
        expect(resource.renderOutsideViewport()).to.equal(true);
        expect(resolveWithinViewportSpy).to.be.calledOnce;
      });

      it('should allow rendering when scrolling away', () => {
        resources.lastVelocity_ = 2;
        expect(resource.renderOutsideViewport()).to.equal(true);
        expect(resolveWithinViewportSpy).to.be.calledOnce;
      });

      describe('when element is owned', () => {
        beforeEach(() => {
          env.sandbox.stub(resource, 'hasOwner').callsFake(() => true);
        });

        it('should allow rendering when scrolling towards', () => {
          resources.lastVelocity_ = -2;
          expect(resource.renderOutsideViewport()).to.equal(true);
          expect(resolveWithinViewportSpy).to.be.calledOnce;
        });

        it('should allow rendering when scrolling away', () => {
          resources.lastVelocity_ = 2;
          expect(resource.renderOutsideViewport()).to.equal(true);
          expect(resolveWithinViewportSpy).to.be.calledOnce;
        });
      });
    });

    describe('when element is marginally above viewport', () => {
      beforeEach(() => {
        resource.layoutBox_ = layoutRectLtwh(0, -250, 100, 100);
      });

      it('should allow rendering when scrolling towards', () => {
        resources.lastVelocity_ = -2;
        expect(resource.renderOutsideViewport()).to.equal(true);
        expect(resolveWithinViewportSpy).to.be.calledOnce;
      });

      it('should disallow rendering when scrolling away', () => {
        resources.lastVelocity_ = 2;
        expect(resource.renderOutsideViewport()).to.equal(false);
        expect(resolveWithinViewportSpy).to.be.called;
      });

      describe('when element is owned', () => {
        beforeEach(() => {
          env.sandbox.stub(resource, 'hasOwner').callsFake(() => true);
        });

        it('should allow rendering when scrolling towards', () => {
          resources.lastVelocity_ = -2;
          expect(resource.renderOutsideViewport()).to.equal(true);
          expect(resolveWithinViewportSpy).to.be.calledOnce;
        });

        it('should allow rendering when scrolling away', () => {
          resources.lastVelocity_ = 2;
          expect(resource.renderOutsideViewport()).to.equal(true);
          expect(resolveWithinViewportSpy).to.be.calledOnce;
        });
      });
    });

    describe('when element is wayyy above viewport', () => {
      beforeEach(() => {
        resource.layoutBox_ = layoutRectLtwh(0, -1000, 100, 100);
      });

      it('should disallow rendering', () => {
        expect(resource.renderOutsideViewport()).to.equal(false);
        expect(resolveWithinViewportSpy).to.be.called;
      });

      it('should disallow rendering when scrolling towards', () => {
        resources.lastVelocity_ = -2;
        expect(resource.renderOutsideViewport()).to.equal(false);
        expect(resolveWithinViewportSpy).to.be.called;
      });

      it('should disallow rendering when scrolling away', () => {
        resources.lastVelocity_ = 2;
        expect(resource.renderOutsideViewport()).to.equal(false);
        expect(resolveWithinViewportSpy).to.be.called;
      });

      describe('when element is owned', () => {
        beforeEach(() => {
          env.sandbox.stub(resource, 'hasOwner').callsFake(() => true);
        });

        it('should allow rendering', () => {
          expect(resource.renderOutsideViewport()).to.equal(true);
          expect(resolveWithinViewportSpy).to.be.calledOnce;
        });

        it('should allow rendering when scrolling towards', () => {
          resources.lastVelocity_ = -2;
          expect(resource.renderOutsideViewport()).to.equal(true);
          expect(resolveWithinViewportSpy).to.be.calledOnce;
        });

        it('should allow rendering when scrolling away', () => {
          resources.lastVelocity_ = 2;
          expect(resource.renderOutsideViewport()).to.equal(true);
          expect(resolveWithinViewportSpy).to.be.calledOnce;
        });
      });
    });

    describe('when element is on the left of viewport', () => {
      beforeEach(() => {
        resource.layoutBox_ = layoutRectLtwh(-200, 0, 100, 100);
      });

      it('should disallow rendering', () => {
        expect(resource.renderOutsideViewport()).to.equal(false);
        expect(resolveWithinViewportSpy).to.be.called;
      });

      it('should disallow rendering when scrolling towards on y-axis', () => {
        resources.lastVelocity_ = -2;
        expect(resource.renderOutsideViewport()).to.equal(false);
        expect(resolveWithinViewportSpy).to.be.called;
      });

      it('should disallow rendering when scrolling away on y-axis', () => {
        resources.lastVelocity_ = 2;
        expect(resource.renderOutsideViewport()).to.equal(false);
        expect(resolveWithinViewportSpy).to.be.called;
      });

      describe('when element is owned', () => {
        beforeEach(() => {
          env.sandbox.stub(resource, 'hasOwner').callsFake(() => true);
        });

        it('should allow rendering', () => {
          expect(resource.renderOutsideViewport()).to.equal(true);
          expect(resolveWithinViewportSpy).to.be.calledOnce;
        });

        it('should allow rendering when scrolling towards on y-axis', () => {
          resources.lastVelocity_ = -2;
          expect(resource.renderOutsideViewport()).to.equal(true);
          expect(resolveWithinViewportSpy).to.be.calledOnce;
        });

        it('should allow rendering when scrolling away on y-axis', () => {
          resources.lastVelocity_ = 2;
          expect(resource.renderOutsideViewport()).to.equal(true);
          expect(resolveWithinViewportSpy).to.be.calledOnce;
        });
      });
    });

    describe('when element is on the right of viewport', () => {
      beforeEach(() => {
        resource.layoutBox_ = layoutRectLtwh(200, 0, 100, 100);
      });

      it('should disallow rendering', () => {
        expect(resource.renderOutsideViewport()).to.equal(false);
        expect(resolveWithinViewportSpy).to.be.called;
      });

      it('should disallow rendering when scrolling towards on y-axis', () => {
        resources.lastVelocity_ = -2;
        expect(resource.renderOutsideViewport()).to.equal(false);
        expect(resolveWithinViewportSpy).to.be.called;
      });

      it('should disallow rendering when scrolling away on y-axis', () => {
        resources.lastVelocity_ = 2;
        expect(resource.renderOutsideViewport()).to.equal(false);
        expect(resolveWithinViewportSpy).to.be.called;
      });

      describe('when element is owned', () => {
        beforeEach(() => {
          env.sandbox.stub(resource, 'hasOwner').callsFake(() => true);
        });

        it('should allow rendering', () => {
          expect(resource.renderOutsideViewport()).to.equal(true);
          expect(resolveWithinViewportSpy).to.be.calledOnce;
        });

        it('should allow rendering when scrolling towards on y-axis', () => {
          resources.lastVelocity_ = -2;
          expect(resource.renderOutsideViewport()).to.equal(true);
          expect(resolveWithinViewportSpy).to.be.calledOnce;
        });

        it('should allow rendering when scrolling away on y-axis', () => {
          resources.lastVelocity_ = 2;
          expect(resource.renderOutsideViewport()).to.equal(true);
          expect(resolveWithinViewportSpy).to.be.calledOnce;
        });
      });
    });

    describe('when element is fully in viewport', () => {
      beforeEach(() => {
        resource.layoutBox_ = layoutRectLtwh(0, 0, 100, 100);
      });

      it('should allow rendering', () => {
        expect(resource.renderOutsideViewport()).to.equal(true);
        expect(resolveWithinViewportSpy).to.be.calledOnce;
      });

      it('should allow rendering when scrolling towards', () => {
        resources.lastVelocity_ = -2;
        expect(resource.renderOutsideViewport()).to.equal(true);
        expect(resolveWithinViewportSpy).to.be.calledOnce;
      });

      it('should allow rendering when scrolling away', () => {
        resources.lastVelocity_ = 2;
        expect(resource.renderOutsideViewport()).to.equal(true);
        expect(resolveWithinViewportSpy).to.be.calledOnce;
      });

      describe('when element is owned', () => {
        beforeEach(() => {
          env.sandbox.stub(resource, 'hasOwner').callsFake(() => true);
        });

        it('should allow rendering', () => {
          expect(resource.renderOutsideViewport()).to.equal(true);
          expect(resolveWithinViewportSpy).to.be.calledOnce;
        });

        it('should allow rendering when scrolling towards on y-axis', () => {
          resources.lastVelocity_ = -2;
          expect(resource.renderOutsideViewport()).to.equal(true);
          expect(resolveWithinViewportSpy).to.be.calledOnce;
        });

        it('should allow rendering when scrolling away on y-axis', () => {
          resources.lastVelocity_ = 2;
          expect(resource.renderOutsideViewport()).to.equal(true);
          expect(resolveWithinViewportSpy).to.be.calledOnce;
        });
      });
    });

    describe('when element is partially in viewport', () => {
      beforeEach(() => {
        resource.layoutBox_ = layoutRectLtwh(-50, -50, 100, 100);
      });

      it('should allow rendering', () => {
        expect(resource.renderOutsideViewport()).to.equal(true);
        expect(resolveWithinViewportSpy).to.be.calledOnce;
      });

      it('should allow rendering when scrolling towards', () => {
        resources.lastVelocity_ = -2;
        expect(resource.renderOutsideViewport()).to.equal(true);
        expect(resolveWithinViewportSpy).to.be.calledOnce;
      });

      it('should allow rendering when scrolling away', () => {
        resources.lastVelocity_ = 2;
        expect(resource.renderOutsideViewport()).to.equal(true);
        expect(resolveWithinViewportSpy).to.be.calledOnce;
      });

      describe('when element is owned', () => {
        beforeEach(() => {
          env.sandbox.stub(resource, 'hasOwner').callsFake(() => true);
        });

        it('should allow rendering', () => {
          expect(resource.renderOutsideViewport()).to.equal(true);
          expect(resolveWithinViewportSpy).to.be.calledOnce;
        });

        it('should allow rendering when scrolling towards on y-axis', () => {
          resources.lastVelocity_ = -2;
          expect(resource.renderOutsideViewport()).to.equal(true);
          expect(resolveWithinViewportSpy).to.be.calledOnce;
        });

        it('should allow rendering when scrolling away on y-axis', () => {
          resources.lastVelocity_ = 2;
          expect(resource.renderOutsideViewport()).to.equal(true);
          expect(resolveWithinViewportSpy).to.be.calledOnce;
        });
      });
    });
  });

  describe('whenWithinViewport', () => {
    it('should resolve correctly', () => {
      env.sandbox
        .stub(resource, 'isWithinViewportRatio')
        .withArgs(3)
        .onCall(0)
        .returns(false)
        .onCall(1)
        .returns(false)
        .onCall(2)
        .returns(true)
        .onCall(3)
        .callsFake(() => {
          throw new Error('should not call!');
        });
      const promise = resource.whenWithinViewport(3);
      // Multiple calls should return the same promise.
      expect(resource.whenWithinViewport(3)).to.equal(promise);
      expect(Object.keys(resource.withViewportDeferreds_)).to.jsonEqual(['3']);
      // Call again should do nothing.
      resource.resolveDeferredsWhenWithinViewports_();
      resource.resolveDeferredsWhenWithinViewports_();
      return promise;
    });

    it('should resolve immediately if already laid out', () => {
      env.sandbox.stub(resource, 'isLayoutPending').returns(false);
      return resource.whenWithinViewport();
    });

    it('should resolve correctly with float', () => {
      const isWithinViewportRatioStub = env.sandbox.stub(
        resource,
        'isWithinViewportRatio'
      );
      const ratio = {};
      env.sandbox.stub(resource, 'getDistanceViewportRatio').returns(ratio);
      isWithinViewportRatioStub.withArgs(1.25).returns(false);
      isWithinViewportRatioStub.withArgs(1.25, ratio).returns(true);
      const promise = resource.whenWithinViewport(1.25);
      resource.resolveDeferredsWhenWithinViewports_();
      return promise;
    });
  });
});

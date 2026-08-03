/* ---- StPageFlip (page-flip) v2, MIT License, bundled inline for offline use ---- */
!function(t,e){"object"==typeof exports&&"undefined"!=typeof module?e(exports):"function"==typeof define&&define.amd?define(["exports"],e):e((t=t||self).St={})}(this,(function(t){"use strict";class e{constructor(t,e){this.state={angle:0,area:[],position:{x:0,y:0},hardAngle:0,hardDrawingAngle:0},this.createdDensity=e,this.nowDrawingDensity=this.createdDensity,this.render=t}setDensity(t){this.createdDensity=t,this.nowDrawingDensity=t}setDrawingDensity(t){this.nowDrawingDensity=t}setPosition(t){this.state.position=t}setAngle(t){this.state.angle=t}setArea(t){this.state.area=t}setHardDrawingAngle(t){this.state.hardDrawingAngle=t}setHardAngle(t){this.state.hardAngle=t,this.state.hardDrawingAngle=t}setOrientation(t){this.orientation=t}getDrawingDensity(){return this.nowDrawingDensity}getDensity(){return this.createdDensity}getHardAngle(){return this.state.hardAngle}}class i extends e{constructor(t,e,i){super(t,i),this.image=null,this.isLoad=!1,this.loadingAngle=0,this.image=new Image,this.image.src=e}draw(t){const e=this.render.getContext(),i=this.render.convertToGlobal(this.state.position),s=this.render.getRect().pageWidth,n=this.render.getRect().height;e.save(),e.translate(i.x,i.y),e.beginPath();for(let t of this.state.area)null!==t&&(t=this.render.convertToGlobal(t),e.lineTo(t.x-i.x,t.y-i.y));e.rotate(this.state.angle),e.clip(),this.isLoad?e.drawImage(this.image,0,0,s,n):this.drawLoader(e,{x:0,y:0},s,n),e.restore()}simpleDraw(t){const e=this.render.getRect(),i=this.render.getContext(),s=e.pageWidth,n=e.height,h=1===t?e.left+e.pageWidth:e.left,r=e.top;this.isLoad?i.drawImage(this.image,h,r,s,n):this.drawLoader(i,{x:h,y:r},s,n)}drawLoader(t,e,i,s){t.beginPath(),t.strokeStyle="rgb(200, 200, 200)",t.fillStyle="rgb(255, 255, 255)",t.lineWidth=1,t.rect(e.x+1,e.y+1,i-1,s-1),t.stroke(),t.fill();const n={x:e.x+i/2,y:e.y+s/2};t.beginPath(),t.lineWidth=10,t.arc(n.x,n.y,20,this.loadingAngle,3*Math.PI/2+this.loadingAngle),t.stroke(),t.closePath(),this.loadingAngle+=.07,this.loadingAngle>=2*Math.PI&&(this.loadingAngle=0)}load(){this.isLoad||(this.image.onload=()=>{this.isLoad=!0})}newTemporaryCopy(){return this}getTemporaryCopy(){return this}hideTemporaryCopy(){}}class s{constructor(t,e){this.pages=[],this.currentPageIndex=0,this.currentSpreadIndex=0,this.landscapeSpread=[],this.portraitSpread=[],this.render=e,this.app=t,this.currentPageIndex=0,this.isShowCover=this.app.getSettings().showCover}destroy(){this.pages=[]}createSpread(){this.landscapeSpread=[],this.portraitSpread=[];for(let t=0;t<this.pages.length;t++)this.portraitSpread.push([t]);let t=0;this.isShowCover&&(this.pages[0].setDensity("hard"),this.landscapeSpread.push([t]),t++);for(let e=t;e<this.pages.length;e+=2)e<this.pages.length-1?this.landscapeSpread.push([e,e+1]):(this.landscapeSpread.push([e]),this.pages[e].setDensity("hard"))}getSpread(){return"landscape"===this.render.getOrientation()?this.landscapeSpread:this.portraitSpread}getSpreadIndexByPage(t){const e=this.getSpread();for(let i=0;i<e.length;i++)if(t===e[i][0]||t===e[i][1])return i;return null}getPageCount(){return this.pages.length}getPages(){return this.pages}getPage(t){if(t>=0&&t<this.pages.length)return this.pages[t];throw new Error("Invalid page number")}nextBy(t){const e=this.pages.indexOf(t);return e<this.pages.length-1?this.pages[e+1]:null}prevBy(t){const e=this.pages.indexOf(t);return e>0?this.pages[e-1]:null}getFlippingPage(t){const e=this.currentSpreadIndex;if("portrait"===this.render.getOrientation())return 0===t?this.pages[e].newTemporaryCopy():this.pages[e-1];{const i=0===t?this.getSpread()[e+1]:this.getSpread()[e-1];return 1===i.length||0===t?this.pages[i[0]]:this.pages[i[1]]}}getBottomPage(t){const e=this.currentSpreadIndex;if("portrait"===this.render.getOrientation())return 0===t?this.pages[e+1]:this.pages[e-1];{const i=0===t?this.getSpread()[e+1]:this.getSpread()[e-1];return 1===i.length?this.pages[i[0]]:0===t?this.pages[i[1]]:this.pages[i[0]]}}showNext(){this.currentSpreadIndex<this.getSpread().length&&(this.currentSpreadIndex++,this.showSpread())}showPrev(){this.currentSpreadIndex>0&&(this.currentSpreadIndex--,this.showSpread())}getCurrentPageIndex(){return this.currentPageIndex}show(t=null){if(null===t&&(t=this.currentPageIndex),t<0||t>=this.pages.length)return;const e=this.getSpreadIndexByPage(t);null!==e&&(this.currentSpreadIndex=e,this.showSpread())}getCurrentSpreadIndex(){return this.currentSpreadIndex}setCurrentSpreadIndex(t){if(!(t>=0&&t<this.getSpread().length))throw new Error("Invalid page");this.currentSpreadIndex=t}showSpread(){const t=this.getSpread()[this.currentSpreadIndex];2===t.length?(this.render.setLeftPage(this.pages[t[0]]),this.render.setRightPage(this.pages[t[1]])):"landscape"===this.render.getOrientation()&&t[0]===this.pages.length-1?(this.render.setLeftPage(this.pages[t[0]]),this.render.setRightPage(null)):(this.render.setLeftPage(null),this.render.setRightPage(this.pages[t[0]])),this.currentPageIndex=t[0],this.app.updatePageIndex(this.currentPageIndex)}}class n extends s{constructor(t,e,i){super(t,e),this.imagesHref=i}load(){for(const t of this.imagesHref){const e=new i(this.render,t,"soft");e.load(),this.pages.push(e)}this.createSpread()}}class h{static GetDistanceBetweenTwoPoint(t,e){return null===t||null===e?1/0:Math.sqrt(Math.pow(e.x-t.x,2)+Math.pow(e.y-t.y,2))}static GetSegmentLength(t){return h.GetDistanceBetweenTwoPoint(t[0],t[1])}static GetAngleBetweenTwoLine(t,e){const i=t[0].y-t[1].y,s=e[0].y-e[1].y,n=t[1].x-t[0].x,h=e[1].x-e[0].x;return Math.acos((i*s+n*h)/(Math.sqrt(i*i+n*n)*Math.sqrt(s*s+h*h)))}static PointInRect(t,e){return null===e?null:e.x>=t.left&&e.x<=t.width+t.left&&e.y>=t.top&&e.y<=t.top+t.height?e:null}static GetRotatedPoint(t,e,i){return{x:t.x*Math.cos(i)+t.y*Math.sin(i)+e.x,y:t.y*Math.cos(i)-t.x*Math.sin(i)+e.y}}static LimitPointToCircle(t,e,i){if(h.GetDistanceBetweenTwoPoint(t,i)<=e)return i;const s=t.x,n=t.y,r=i.x,o=i.y;let a=Math.sqrt(Math.pow(e,2)*Math.pow(s-r,2)/(Math.pow(s-r,2)+Math.pow(n-o,2)))+s;i.x<0&&(a*=-1);let g=(a-s)*(n-o)/(s-r)+n;return s-r+n===0&&(g=e),{x:a,y:g}}static GetIntersectBetweenTwoSegment(t,e,i){return h.PointInRect(t,h.GetIntersectBeetwenTwoLine(e,i))}static GetIntersectBeetwenTwoLine(t,e){const i=t[0].y-t[1].y,s=e[0].y-e[1].y,n=t[1].x-t[0].x,h=e[1].x-e[0].x,r=t[0].x*t[1].y-t[1].x*t[0].y,o=e[0].x*e[1].y-e[1].x*e[0].y,a=i*o-s*r,g=n*o-h*r,l=-(r*h-o*n)/(i*h-s*n),d=-(i*o-s*r)/(i*h-s*n);if(isFinite(l)&&isFinite(d))return{x:l,y:d};if(Math.abs(a-g)<.1)throw new Error("Segment included");return null}static GetCordsFromTwoPoint(t,e){const i=Math.abs(t.x-e.x),s=Math.abs(t.y-e.y),n=Math.max(i,s),h=[t];function r(t,e,i,s,n){return e>t?t+n*(i/s):e<t?t-n*(i/s):t}for(let o=1;o<=n;o+=1)h.push({x:r(t.x,e.x,i,n,o),y:r(t.y,e.y,s,n,o)});return h}}class r extends e{constructor(t,e,i){super(t,i),this.copiedElement=null,this.temporaryCopy=null,this.isLoad=!1,this.element=e,this.element.classList.add("stf__item"),this.element.classList.add("--"+i)}newTemporaryCopy(){return"hard"===this.nowDrawingDensity?this:(null===this.temporaryCopy&&(this.copiedElement=this.element.cloneNode(!0),this.element.parentElement.appendChild(this.copiedElement),this.temporaryCopy=new r(this.render,this.copiedElement,this.nowDrawingDensity)),this.getTemporaryCopy())}getTemporaryCopy(){return this.temporaryCopy}hideTemporaryCopy(){null!==this.temporaryCopy&&(this.copiedElement.remove(),this.copiedElement=null,this.temporaryCopy=null)}draw(t){const e=t||this.nowDrawingDensity,i=this.render.convertToGlobal(this.state.position),s=this.render.getRect().pageWidth,n=this.render.getRect().height;this.element.classList.remove("--simple");const h=`\n            display: block;\n            z-index: ${this.element.style.zIndex};\n            left: 0;\n            top: 0;\n            width: ${s}px;\n            height: ${n}px;\n        `;"hard"===e?this.drawHard(h):this.drawSoft(i,h)}drawHard(t=""){const e=this.render.getRect().left+this.render.getRect().width/2,i=this.state.hardDrawingAngle,s=t+"\n                backface-visibility: hidden;\n                -webkit-backface-visibility: hidden;\n                clip-path: none;\n                -webkit-clip-path: none;\n            "+(0===this.orientation?`transform-origin: ${this.render.getRect().pageWidth}px 0; \n                   transform: translate3d(0, 0, 0) rotateY(${i}deg);`:`transform-origin: 0 0; \n                   transform: translate3d(${e}px, 0, 0) rotateY(${i}deg);`);this.element.style.cssText=s}drawSoft(t,e=""){let i="polygon( ";for(const t of this.state.area)if(null!==t){let e=1===this.render.getDirection()?{x:-t.x+this.state.position.x,y:t.y-this.state.position.y}:{x:t.x-this.state.position.x,y:t.y-this.state.position.y};e=h.GetRotatedPoint(e,{x:0,y:0},this.state.angle),i+=e.x+"px "+e.y+"px, "}i=i.slice(0,-2),i+=")";const s=e+`transform-origin: 0 0; clip-path: ${i}; -webkit-clip-path: ${i};`+(this.render.isSafari()&&0===this.state.angle?`transform: translate(${t.x}px, ${t.y}px);`:`transform: translate3d(${t.x}px, ${t.y}px, 0) rotate(${this.state.angle}rad);`);this.element.style.cssText=s}simpleDraw(t){const e=this.render.getRect(),i=e.pageWidth,s=e.height,n=1===t?e.left+e.pageWidth:e.left,h=e.top;this.element.classList.add("--simple"),this.element.style.cssText=`\n            position: absolute; \n            display: block; \n            height: ${s}px; \n            left: ${n}px; \n            top: ${h}px; \n            width: ${i}px; \n            z-index: ${this.render.getSettings().startZIndex+1};`}getElement(){return this.element}load(){this.isLoad=!0}setOrientation(t){super.setOrientation(t),this.element.classList.remove("--left","--right"),this.element.classList.add(1===t?"--right":"--left")}setDrawingDensity(t){this.element.classList.remove("--soft","--hard"),this.element.classList.add("--"+t),super.setDrawingDensity(t)}}class o extends s{constructor(t,e,i,s){super(t,e),this.element=i,this.pagesElement=s}load(){for(const t of this.pagesElement){const e=new r(this.render,t,"hard"===t.dataset.density?"hard":"soft");e.load(),this.pages.push(e)}this.createSpread()}}class a{constructor(t,e,i,s){this.direction=t,this.corner=e,this.topIntersectPoint=null,this.sideIntersectPoint=null,this.bottomIntersectPoint=null,this.pageWidth=parseInt(i,10),this.pageHeight=parseInt(s,10)}calc(t){try{return this.position=this.calcAngleAndPosition(t),this.calculateIntersectPoint(this.position),!0}catch(t){return!1}}getFlippingClipArea(){const t=[];let e=!1;return t.push(this.rect.topLeft),t.push(this.topIntersectPoint),null===this.sideIntersectPoint?e=!0:(t.push(this.sideIntersectPoint),null===this.bottomIntersectPoint&&(e=!1)),t.push(this.bottomIntersectPoint),(e||"bottom"===this.corner)&&t.push(this.rect.bottomLeft),t}getBottomClipArea(){const t=[];return t.push(this.topIntersectPoint),"top"===this.corner?t.push({x:this.pageWidth,y:0}):(null!==this.topIntersectPoint&&t.push({x:this.pageWidth,y:0}),t.push({x:this.pageWidth,y:this.pageHeight})),null!==this.sideIntersectPoint?h.GetDistanceBetweenTwoPoint(this.sideIntersectPoint,this.topIntersectPoint)>=10&&t.push(this.sideIntersectPoint):"top"===this.corner&&t.push({x:this.pageWidth,y:this.pageHeight}),t.push(this.bottomIntersectPoint),t.push(this.topIntersectPoint),t}getAngle(){return 0===this.direction?-this.angle:this.angle}getRect(){return this.rect}getPosition(){return this.position}getActiveCorner(){return 0===this.direction?this.rect.topLeft:this.rect.topRight}getDirection(){return this.direction}getFlippingProgress(){return Math.abs((this.position.x-this.pageWidth)/(2*this.pageWidth)*100)}getCorner(){return this.corner}getBottomPagePosition(){return 1===this.direction?{x:this.pageWidth,y:0}:{x:0,y:0}}getShadowStartPoint(){return"top"===this.corner?this.topIntersectPoint:null!==this.sideIntersectPoint?this.sideIntersectPoint:this.topIntersectPoint}getShadowAngle(){const t=h.GetAngleBetweenTwoLine(this.getSegmentToShadowLine(),[{x:0,y:0},{x:this.pageWidth,y:0}]);return 0===this.direction?t:Math.PI-t}calcAngleAndPosition(t){let e=t;if(this.updateAngleAndGeometry(e),e="top"===this.corner?this.checkPositionAtCenterLine(e,{x:0,y:0},{x:0,y:this.pageHeight}):this.checkPositionAtCenterLine(e,{x:0,y:this.pageHeight},{x:0,y:0}),Math.abs(e.x-this.pageWidth)<1&&Math.abs(e.y)<1)throw new Error("Point is too small");return e}updateAngleAndGeometry(t){this.angle=this.calculateAngle(t),this.rect=this.getPageRect(t)}calculateAngle(t){const e=this.pageWidth-t.x+1,i="bottom"===this.corner?this.pageHeight-t.y:t.y;let s=2*Math.acos(e/Math.sqrt(i*i+e*e));i<0&&(s=-s);const n=Math.PI-s;if(!isFinite(s)||n>=0&&n<.003)throw new Error("The G point is too small");return"bottom"===this.corner&&(s=-s),s}getPageRect(t){return"top"===this.corner?this.getRectFromBasePoint([{x:0,y:0},{x:this.pageWidth,y:0},{x:0,y:this.pageHeight},{x:this.pageWidth,y:this.pageHeight}],t):this.getRectFromBasePoint([{x:0,y:-this.pageHeight},{x:this.pageWidth,y:-this.pageHeight},{x:0,y:0},{x:this.pageWidth,y:0}],t)}getRectFromBasePoint(t,e){return{topLeft:this.getRotatedPoint(t[0],e),topRight:this.getRotatedPoint(t[1],e),bottomLeft:this.getRotatedPoint(t[2],e),bottomRight:this.getRotatedPoint(t[3],e)}}getRotatedPoint(t,e){return{x:t.x*Math.cos(this.angle)+t.y*Math.sin(this.angle)+e.x,y:t.y*Math.cos(this.angle)-t.x*Math.sin(this.angle)+e.y}}calculateIntersectPoint(t){const e={left:-1,top:-1,width:this.pageWidth+2,height:this.pageHeight+2};"top"===this.corner?(this.topIntersectPoint=h.GetIntersectBetweenTwoSegment(e,[t,this.rect.topRight],[{x:0,y:0},{x:this.pageWidth,y:0}]),this.sideIntersectPoint=h.GetIntersectBetweenTwoSegment(e,[t,this.rect.bottomLeft],[{x:this.pageWidth,y:0},{x:this.pageWidth,y:this.pageHeight}]),this.bottomIntersectPoint=h.GetIntersectBetweenTwoSegment(e,[this.rect.bottomLeft,this.rect.bottomRight],[{x:0,y:this.pageHeight},{x:this.pageWidth,y:this.pageHeight}])):(this.topIntersectPoint=h.GetIntersectBetweenTwoSegment(e,[this.rect.topLeft,this.rect.topRight],[{x:0,y:0},{x:this.pageWidth,y:0}]),this.sideIntersectPoint=h.GetIntersectBetweenTwoSegment(e,[t,this.rect.topLeft],[{x:this.pageWidth,y:0},{x:this.pageWidth,y:this.pageHeight}]),this.bottomIntersectPoint=h.GetIntersectBetweenTwoSegment(e,[this.rect.bottomLeft,this.rect.bottomRight],[{x:0,y:this.pageHeight},{x:this.pageWidth,y:this.pageHeight}]))}checkPositionAtCenterLine(t,e,i){let s=t;const n=h.LimitPointToCircle(e,this.pageWidth,s);s!==n&&(s=n,this.updateAngleAndGeometry(s));const r=Math.sqrt(Math.pow(this.pageWidth,2)+Math.pow(this.pageHeight,2));let o=this.rect.bottomRight,a=this.rect.topLeft;if("bottom"===this.corner&&(o=this.rect.topRight,a=this.rect.bottomLeft),o.x<=0){const t=h.LimitPointToCircle(i,r,a);t!==s&&(s=t,this.updateAngleAndGeometry(s))}return s}getSegmentToShadowLine(){const t=this.getShadowStartPoint();return[t,t!==this.sideIntersectPoint&&null!==this.sideIntersectPoint?this.sideIntersectPoint:this.bottomIntersectPoint]}}class g{constructor(t,e){this.flippingPage=null,this.bottomPage=null,this.calc=null,this.state="read",this.render=t,this.app=e}fold(t){this.setState("user_fold"),null===this.calc&&this.start(t),this.do(this.render.convertToPage(t))}flip(t){if(this.app.getSettings().disableFlipByClick&&!this.isPointOnCorners(t))return;if(null!==this.calc&&this.render.finishAnimation(),!this.start(t))return;const e=this.getBoundsRect();this.setState("flipping");const i=e.height/10,s="bottom"===this.calc.getCorner()?e.height-i:i,n="bottom"===this.calc.getCorner()?e.height:0;this.calc.calc({x:e.pageWidth-i,y:s}),this.animateFlippingTo({x:e.pageWidth-i,y:s},{x:-e.pageWidth,y:n},!0)}start(t){this.reset();const e=this.render.convertToBook(t),i=this.getBoundsRect(),s=this.getDirectionByPoint(e),n=e.y>=i.height/2?"bottom":"top";if(!this.checkDirection(s))return!1;try{if(this.flippingPage=this.app.getPageCollection().getFlippingPage(s),this.bottomPage=this.app.getPageCollection().getBottomPage(s),"landscape"===this.render.getOrientation())if(1===s){const t=this.app.getPageCollection().nextBy(this.flippingPage);null!==t&&this.flippingPage.getDensity()!==t.getDensity()&&(this.flippingPage.setDrawingDensity("hard"),t.setDrawingDensity("hard"))}else{const t=this.app.getPageCollection().prevBy(this.flippingPage);null!==t&&this.flippingPage.getDensity()!==t.getDensity()&&(this.flippingPage.setDrawingDensity("hard"),t.setDrawingDensity("hard"))}return this.render.setDirection(s),this.calc=new a(s,n,i.pageWidth.toString(10),i.height.toString(10)),!0}catch(t){return!1}}do(t){if(null!==this.calc&&this.calc.calc(t)){const t=this.calc.getFlippingProgress();this.bottomPage.setArea(this.calc.getBottomClipArea()),this.bottomPage.setPosition(this.calc.getBottomPagePosition()),this.bottomPage.setAngle(0),this.bottomPage.setHardAngle(0),this.flippingPage.setArea(this.calc.getFlippingClipArea()),this.flippingPage.setPosition(this.calc.getActiveCorner()),this.flippingPage.setAngle(this.calc.getAngle()),0===this.calc.getDirection()?this.flippingPage.setHardAngle(90*(200-2*t)/100):this.flippingPage.setHardAngle(-90*(200-2*t)/100),this.render.setPageRect(this.calc.getRect()),this.render.setBottomPage(this.bottomPage),this.render.setFlippingPage(this.flippingPage),this.render.setShadowData(this.calc.getShadowStartPoint(),this.calc.getShadowAngle(),t,this.calc.getDirection())}}flipToPage(t,e){const i=this.app.getPageCollection().getCurrentSpreadIndex(),s=this.app.getPageCollection().getSpreadIndexByPage(t);try{s>i&&(this.app.getPageCollection().setCurrentSpreadIndex(s-1),this.flipNext(e)),s<i&&(this.app.getPageCollection().setCurrentSpreadIndex(s+1),this.flipPrev(e))}catch(t){}}flipNext(t){this.flip({x:this.render.getRect().left+2*this.render.getRect().pageWidth-10,y:"top"===t?1:this.render.getRect().height-2})}flipPrev(t){this.flip({x:10,y:"top"===t?1:this.render.getRect().height-2})}stopMove(){if(null===this.calc)return;const t=this.calc.getPosition(),e=this.getBoundsRect(),i="bottom"===this.calc.getCorner()?e.height:0;t.x<=0?this.animateFlippingTo(t,{x:-e.pageWidth,y:i},!0):this.animateFlippingTo(t,{x:e.pageWidth,y:i},!1)}showCorner(t){if(!this.checkState("read","fold_corner"))return;const e=this.getBoundsRect(),i=e.pageWidth;if(this.isPointOnCorners(t))if(null===this.calc){if(!this.start(t))return;this.setState("fold_corner"),this.calc.calc({x:i-1,y:1});const s=50,n="bottom"===this.calc.getCorner()?e.height-1:1,h="bottom"===this.calc.getCorner()?e.height-s:s;this.animateFlippingTo({x:i-1,y:n},{x:i-s,y:h},!1,!1)}else this.do(this.render.convertToPage(t));else this.setState("read"),this.render.finishAnimation(),this.stopMove()}animateFlippingTo(t,e,i,s=!0){const n=h.GetCordsFromTwoPoint(t,e),r=[];for(const t of n)r.push(()=>this.do(t));const o=this.getAnimationDuration(n.length);this.render.startAnimation(r,o,()=>{this.calc&&(i&&(1===this.calc.getDirection()?this.app.turnToPrevPage():this.app.turnToNextPage()),s&&(this.render.setBottomPage(null),this.render.setFlippingPage(null),this.render.clearShadow(),this.setState("read"),this.reset()))})}getCalculation(){return this.calc}getState(){return this.state}setState(t){this.state!==t&&(this.app.updateState(t),this.state=t)}getDirectionByPoint(t){const e=this.getBoundsRect();if("portrait"===this.render.getOrientation()){if(t.x-e.pageWidth<=e.width/5)return 1}else if(t.x<e.width/2)return 1;return 0}getAnimationDuration(t){const e=this.app.getSettings().flippingTime;return t>=1e3?e:t/1e3*e}checkDirection(t){return 0===t?this.app.getCurrentPageIndex()<this.app.getPageCount()-1:this.app.getCurrentPageIndex()>=1}reset(){this.calc=null,this.flippingPage=null,this.bottomPage=null}getBoundsRect(){return this.render.getRect()}checkState(...t){for(const e of t)if(this.state===e)return!0;return!1}isPointOnCorners(t){const e=this.getBoundsRect(),i=e.pageWidth,s=Math.sqrt(Math.pow(i,2)+Math.pow(e.height,2))/5,n=this.render.convertToBook(t);return n.x>0&&n.y>0&&n.x<e.width&&n.y<e.height&&(n.x<s||n.x>e.width-s)&&(n.y<s||n.y>e.height-s)}}class l{constructor(t,e){this.leftPage=null,this.rightPage=null,this.flippingPage=null,this.bottomPage=null,this.direction=null,this.orientation=null,this.shadow=null,this.animation=null,this.pageRect=null,this.boundsRect=null,this.timer=0,this.safari=!1,this.setting=e,this.app=t;const i=new RegExp("Version\\/[\\d\\.]+.*Safari/");this.safari=null!==i.exec(window.navigator.userAgent)}render(t){if(null!==this.animation){const e=Math.round((t-this.animation.startedAt)/this.animation.durationFrame);e<this.animation.frames.length?this.animation.frames[e]():(this.animation.onAnimateEnd(),this.animation=null)}this.timer=t,this.drawFrame()}start(){this.update();const t=e=>{this.render(e),requestAnimationFrame(t)};requestAnimationFrame(t)}startAnimation(t,e,i){this.finishAnimation(),this.animation={frames:t,duration:e,durationFrame:e/t.length,onAnimateEnd:i,startedAt:this.timer}}finishAnimation(){null!==this.animation&&(this.animation.frames[this.animation.frames.length-1](),null!==this.animation.onAnimateEnd&&this.animation.onAnimateEnd()),this.animation=null}update(){this.boundsRect=null;const t=this.calculateBoundsRect();this.orientation!==t&&(this.orientation=t,this.app.updateOrientation(t))}calculateBoundsRect(){let t="landscape";const e=this.getBlockWidth(),i=e/2,s=this.getBlockHeight()/2,n=this.setting.width/this.setting.height;let h=this.setting.width,r=this.setting.height,o=i-h;return"stretch"===this.setting.size?(e<2*this.setting.minWidth&&this.app.getSettings().usePortrait&&(t="portrait"),h="portrait"===t?this.getBlockWidth():this.getBlockWidth()/2,h>this.setting.maxWidth&&(h=this.setting.maxWidth),r=h/n,r>this.getBlockHeight()&&(r=this.getBlockHeight(),h=r*n),o="portrait"===t?i-h/2-h:i-h):e<2*h&&this.app.getSettings().usePortrait&&(t="portrait",o=i-h/2-h),this.boundsRect={left:o,top:s-r/2,width:2*h,height:r,pageWidth:h},t}setShadowData(t,e,i,s){if(!this.app.getSettings().drawShadow)return;const n=100*this.getSettings().maxShadowOpacity;this.shadow={pos:t,angle:e,width:3*this.getRect().pageWidth/4*i/100,opacity:(100-i)*n/100/100,direction:s,progress:2*i}}clearShadow(){this.shadow=null}getBlockWidth(){return this.app.getUI().getDistElement().offsetWidth}getBlockHeight(){return this.app.getUI().getDistElement().offsetHeight}getDirection(){return this.direction}getRect(){return null===this.boundsRect&&this.calculateBoundsRect(),this.boundsRect}getSettings(){return this.app.getSettings()}getOrientation(){return this.orientation}setPageRect(t){this.pageRect=t}setDirection(t){this.direction=t}setRightPage(t){null!==t&&t.setOrientation(1),this.rightPage=t}setLeftPage(t){null!==t&&t.setOrientation(0),this.leftPage=t}setBottomPage(t){null!==t&&t.setOrientation(1===this.direction?0:1),this.bottomPage=t}setFlippingPage(t){null!==t&&t.setOrientation(0===this.direction&&"portrait"!==this.orientation?0:1),this.flippingPage=t}convertToBook(t){const e=this.getRect();return{x:t.x-e.left,y:t.y-e.top}}isSafari(){return this.safari}convertToPage(t,e){e||(e=this.direction);const i=this.getRect();return{x:0===e?t.x-i.left-i.width/2:i.width/2-t.x+i.left,y:t.y-i.top}}convertToGlobal(t,e){if(e||(e=this.direction),null==t)return null;const i=this.getRect();return{x:0===e?t.x+i.left+i.width/2:i.width/2-t.x+i.left,y:t.y+i.top}}convertRectToGlobal(t,e){return e||(e=this.direction),{topLeft:this.convertToGlobal(t.topLeft,e),topRight:this.convertToGlobal(t.topRight,e),bottomLeft:this.convertToGlobal(t.bottomLeft,e),bottomRight:this.convertToGlobal(t.bottomRight,e)}}}class d extends l{constructor(t,e,i){super(t,e),this.canvas=i,this.ctx=i.getContext("2d")}getContext(){return this.ctx}reload(){}drawFrame(){this.clear(),"portrait"!==this.orientation&&null!=this.leftPage&&this.leftPage.simpleDraw(0),null!=this.rightPage&&this.rightPage.simpleDraw(1),null!=this.bottomPage&&this.bottomPage.draw(),this.drawBookShadow(),null!=this.flippingPage&&this.flippingPage.draw(),null!=this.shadow&&(this.drawOuterShadow(),this.drawInnerShadow());const t=this.getRect();"portrait"===this.orientation&&(this.ctx.beginPath(),this.ctx.rect(t.left+t.pageWidth,t.top,t.width,t.height),this.ctx.clip())}drawBookShadow(){const t=this.getRect();this.ctx.save(),this.ctx.beginPath();const e=t.width/20;this.ctx.rect(t.left,t.top,t.width,t.height);const i={x:t.left+t.width/2-e/2,y:0};this.ctx.translate(i.x,i.y);const s=this.ctx.createLinearGradient(0,0,e,0);s.addColorStop(0,"rgba(0, 0, 0, 0)"),s.addColorStop(.4,"rgba(0, 0, 0, 0.2)"),s.addColorStop(.49,"rgba(0, 0, 0, 0.1)"),s.addColorStop(.5,"rgba(0, 0, 0, 0.5)"),s.addColorStop(.51,"rgba(0, 0, 0, 0.4)"),s.addColorStop(1,"rgba(0, 0, 0, 0)"),this.ctx.clip(),this.ctx.fillStyle=s,this.ctx.fillRect(0,0,e,2*t.height),this.ctx.restore()}drawOuterShadow(){const t=this.getRect();this.ctx.save(),this.ctx.beginPath(),this.ctx.rect(t.left,t.top,t.width,t.height);const e=this.convertToGlobal({x:this.shadow.pos.x,y:this.shadow.pos.y});this.ctx.translate(e.x,e.y),this.ctx.rotate(Math.PI+this.shadow.angle+Math.PI/2);const i=this.ctx.createLinearGradient(0,0,this.shadow.width,0);0===this.shadow.direction?(this.ctx.translate(0,-100),i.addColorStop(0,"rgba(0, 0, 0, "+this.shadow.opacity+")"),i.addColorStop(1,"rgba(0, 0, 0, 0)")):(this.ctx.translate(-this.shadow.width,-100),i.addColorStop(0,"rgba(0, 0, 0, 0)"),i.addColorStop(1,"rgba(0, 0, 0, "+this.shadow.opacity+")")),this.ctx.clip(),this.ctx.fillStyle=i,this.ctx.fillRect(0,0,this.shadow.width,2*t.height),this.ctx.restore()}drawInnerShadow(){const t=this.getRect();this.ctx.save(),this.ctx.beginPath();const e=this.convertToGlobal({x:this.shadow.pos.x,y:this.shadow.pos.y}),i=this.convertRectToGlobal(this.pageRect);this.ctx.moveTo(i.topLeft.x,i.topLeft.y),this.ctx.lineTo(i.topRight.x,i.topRight.y),this.ctx.lineTo(i.bottomRight.x,i.bottomRight.y),this.ctx.lineTo(i.bottomLeft.x,i.bottomLeft.y),this.ctx.translate(e.x,e.y),this.ctx.rotate(Math.PI+this.shadow.angle+Math.PI/2);const s=3*this.shadow.width/4,n=this.ctx.createLinearGradient(0,0,s,0);0===this.shadow.direction?(this.ctx.translate(-s,-100),n.addColorStop(1,"rgba(0, 0, 0, "+this.shadow.opacity+")"),n.addColorStop(.9,"rgba(0, 0, 0, 0.05)"),n.addColorStop(.7,"rgba(0, 0, 0, "+this.shadow.opacity+")"),n.addColorStop(0,"rgba(0, 0, 0, 0)")):(this.ctx.translate(0,-100),n.addColorStop(0,"rgba(0, 0, 0, "+this.shadow.opacity+")"),n.addColorStop(.1,"rgba(0, 0, 0, 0.05)"),n.addColorStop(.3,"rgba(0, 0, 0, "+this.shadow.opacity+")"),n.addColorStop(1,"rgba(0, 0, 0, 0)")),this.ctx.clip(),this.ctx.fillStyle=n,this.ctx.fillRect(0,0,s,2*t.height),this.ctx.restore()}clear(){this.ctx.fillStyle="white",this.ctx.fillRect(0,0,this.canvas.width,this.canvas.height)}}class p{constructor(t,e,i){this.touchPoint=null,this.swipeTimeout=250,this.onResize=()=>{this.update()},this.onMouseDown=t=>{if(this.checkTarget(t.target)){const e=this.getMousePos(t.clientX,t.clientY);this.app.startUserTouch(e),t.preventDefault()}},this.onTouchStart=t=>{if(this.checkTarget(t.target)&&t.changedTouches.length>0){const e=t.changedTouches[0],i=this.getMousePos(e.clientX,e.clientY);this.touchPoint={point:i,time:Date.now()},setTimeout(()=>{null!==this.touchPoint&&this.app.startUserTouch(i)},this.swipeTimeout),this.app.getSettings().mobileScrollSupport||t.preventDefault()}},this.onMouseUp=t=>{const e=this.getMousePos(t.clientX,t.clientY);this.app.userStop(e)},this.onMouseMove=t=>{const e=this.getMousePos(t.clientX,t.clientY);this.app.userMove(e,!1)},this.onTouchMove=t=>{if(t.changedTouches.length>0){const e=t.changedTouches[0],i=this.getMousePos(e.clientX,e.clientY);this.app.getSettings().mobileScrollSupport?(null!==this.touchPoint&&(Math.abs(this.touchPoint.point.x-i.x)>10||"read"!==this.app.getState())&&t.cancelable&&this.app.userMove(i,!0),"read"!==this.app.getState()&&t.preventDefault()):this.app.userMove(i,!0)}},this.onTouchEnd=t=>{if(t.changedTouches.length>0){const e=t.changedTouches[0],i=this.getMousePos(e.clientX,e.clientY);let s=!1;if(null!==this.touchPoint){const t=i.x-this.touchPoint.point.x,e=Math.abs(i.y-this.touchPoint.point.y);Math.abs(t)>this.swipeDistance&&e<2*this.swipeDistance&&Date.now()-this.touchPoint.time<this.swipeTimeout&&(t>0?this.app.flipPrev(this.touchPoint.point.y<this.app.getRender().getRect().height/2?"top":"bottom"):this.app.flipNext(this.touchPoint.point.y<this.app.getRender().getRect().height/2?"top":"bottom"),s=!0),this.touchPoint=null}this.app.userStop(i,s)}},this.parentElement=t,t.classList.add("stf__parent"),t.insertAdjacentHTML("afterbegin",'<div class="stf__wrapper"></div>'),this.wrapper=t.querySelector(".stf__wrapper"),this.app=e;const s=this.app.getSettings().usePortrait?1:2;t.style.minWidth=i.minWidth*s+"px",t.style.minHeight=i.minHeight+"px","fixed"===i.size&&(t.style.minWidth=i.width*s+"px",t.style.minHeight=i.height+"px"),i.autoSize&&(t.style.width="100%",t.style.maxWidth=2*i.maxWidth+"px"),t.style.display="block",window.addEventListener("resize",this.onResize,!1),this.swipeDistance=i.swipeDistance}destroy(){this.app.getSettings().useMouseEvents&&this.removeHandlers(),this.distElement.remove(),this.wrapper.remove()}getDistElement(){return this.distElement}getWrapper(){return this.wrapper}setOrientationStyle(t){this.wrapper.classList.remove("--portrait","--landscape"),"portrait"===t?(this.app.getSettings().autoSize&&(this.wrapper.style.paddingBottom=this.app.getSettings().height/this.app.getSettings().width*100+"%"),this.wrapper.classList.add("--portrait")):(this.app.getSettings().autoSize&&(this.wrapper.style.paddingBottom=this.app.getSettings().height/(2*this.app.getSettings().width)*100+"%"),this.wrapper.classList.add("--landscape")),this.update()}removeHandlers(){window.removeEventListener("resize",this.onResize),this.distElement.removeEventListener("mousedown",this.onMouseDown),this.distElement.removeEventListener("touchstart",this.onTouchStart),window.removeEventListener("mousemove",this.onMouseMove),window.removeEventListener("touchmove",this.onTouchMove),window.removeEventListener("mouseup",this.onMouseUp),window.removeEventListener("touchend",this.onTouchEnd)}setHandlers(){window.addEventListener("resize",this.onResize,!1),this.app.getSettings().useMouseEvents&&(this.distElement.addEventListener("mousedown",this.onMouseDown),this.distElement.addEventListener("touchstart",this.onTouchStart),window.addEventListener("mousemove",this.onMouseMove),window.addEventListener("touchmove",this.onTouchMove,{passive:!this.app.getSettings().mobileScrollSupport}),window.addEventListener("mouseup",this.onMouseUp),window.addEventListener("touchend",this.onTouchEnd))}getMousePos(t,e){const i=this.distElement.getBoundingClientRect();return{x:t-i.left,y:e-i.top}}checkTarget(t){return!this.app.getSettings().clickEventForward||!["a","button"].includes(t.tagName.toLowerCase())}}class c extends p{constructor(t,e,i,s){super(t,e,i),this.wrapper.insertAdjacentHTML("afterbegin",'<div class="stf__block"></div>'),this.distElement=t.querySelector(".stf__block"),this.items=s;for(const t of s)this.distElement.appendChild(t);this.setHandlers()}clear(){for(const t of this.items)this.parentElement.appendChild(t)}updateItems(t){this.removeHandlers(),this.distElement.innerHTML="";for(const e of t)this.distElement.appendChild(e);this.items=t,this.setHandlers()}update(){this.app.getRender().update()}}class u extends p{constructor(t,e,i){super(t,e,i),this.wrapper.innerHTML='<canvas class="stf__canvas"></canvas>',this.canvas=t.querySelectorAll("canvas")[0],this.distElement=this.canvas,this.resizeCanvas(),this.setHandlers()}resizeCanvas(){const t=getComputedStyle(this.canvas),e=parseInt(t.getPropertyValue("width"),10),i=parseInt(t.getPropertyValue("height"),10);this.canvas.width=e,this.canvas.height=i}getCanvas(){return this.canvas}update(){this.resizeCanvas(),this.app.getRender().update()}}class w extends l{constructor(t,e,i){super(t,e),this.outerShadow=null,this.innerShadow=null,this.hardShadow=null,this.hardInnerShadow=null,this.element=i,this.createShadows()}createShadows(){this.element.insertAdjacentHTML("beforeend",'<div class="stf__outerShadow"></div>\n             <div class="stf__innerShadow"></div>\n             <div class="stf__hardShadow"></div>\n             <div class="stf__hardInnerShadow"></div>'),this.outerShadow=this.element.querySelector(".stf__outerShadow"),this.innerShadow=this.element.querySelector(".stf__innerShadow"),this.hardShadow=this.element.querySelector(".stf__hardShadow"),this.hardInnerShadow=this.element.querySelector(".stf__hardInnerShadow")}clearShadow(){super.clearShadow(),this.outerShadow.style.cssText="display: none",this.innerShadow.style.cssText="display: none",this.hardShadow.style.cssText="display: none",this.hardInnerShadow.style.cssText="display: none"}reload(){this.element.querySelector(".stf__outerShadow")||this.createShadows()}drawHardInnerShadow(){const t=this.getRect(),e=this.shadow.progress>100?200-this.shadow.progress:this.shadow.progress;let i=(100-e)*(2.5*t.pageWidth)/100+20;i>t.pageWidth&&(i=t.pageWidth);let s=`\n            display: block;\n            z-index: ${(this.getSettings().startZIndex+5).toString(10)};\n            width: ${i}px;\n            height: ${t.height}px;\n            background: linear-gradient(to right,\n                rgba(0, 0, 0, ${this.shadow.opacity*e/100}) 5%,\n                rgba(0, 0, 0, 0) 100%);\n            left: ${t.left+t.width/2}px;\n            transform-origin: 0 0;\n        `;s+=0===this.getDirection()&&this.shadow.progress>100||1===this.getDirection()&&this.shadow.progress<=100?"transform: translate3d(0, 0, 0);":"transform: translate3d(0, 0, 0) rotateY(180deg);",this.hardInnerShadow.style.cssText=s}drawHardOuterShadow(){const t=this.getRect();let e=(100-(this.shadow.progress>100?200-this.shadow.progress:this.shadow.progress))*(2.5*t.pageWidth)/100+20;e>t.pageWidth&&(e=t.pageWidth);let i=`\n            display: block;\n            z-index: ${(this.getSettings().startZIndex+4).toString(10)};\n            width: ${e}px;\n            height: ${t.height}px;\n            background: linear-gradient(to left, rgba(0, 0, 0, ${this.shadow.opacity}) 5%, rgba(0, 0, 0, 0) 100%);\n            left: ${t.left+t.width/2}px;\n            transform-origin: 0 0;\n        `;i+=0===this.getDirection()&&this.shadow.progress>100||1===this.getDirection()&&this.shadow.progress<=100?"transform: translate3d(0, 0, 0) rotateY(180deg);":"transform: translate3d(0, 0, 0);",this.hardShadow.style.cssText=i}drawInnerShadow(){const t=this.getRect(),e=3*this.shadow.width/4,i=0===this.getDirection()?e:0,s=0===this.getDirection()?"to left":"to right",n=this.convertToGlobal(this.shadow.pos),r=this.shadow.angle+3*Math.PI/2,o=[this.pageRect.topLeft,this.pageRect.topRight,this.pageRect.bottomRight,this.pageRect.bottomLeft];let a="polygon( ";for(const t of o){let e=1===this.getDirection()?{x:-t.x+this.shadow.pos.x,y:t.y-this.shadow.pos.y}:{x:t.x-this.shadow.pos.x,y:t.y-this.shadow.pos.y};e=h.GetRotatedPoint(e,{x:i,y:100},r),a+=e.x+"px "+e.y+"px, "}a=a.slice(0,-2),a+=")";const g=`\n            display: block;\n            z-index: ${(this.getSettings().startZIndex+10).toString(10)};\n            width: ${e}px;\n            height: ${2*t.height}px;\n            background: linear-gradient(${s},\n                rgba(0, 0, 0, ${this.shadow.opacity}) 5%,\n                rgba(0, 0, 0, 0.05) 15%,\n                rgba(0, 0, 0, ${this.shadow.opacity}) 35%,\n                rgba(0, 0, 0, 0) 100%);\n            transform-origin: ${i}px 100px;\n            transform: translate3d(${n.x-i}px, ${n.y-100}px, 0) rotate(${r}rad);\n            clip-path: ${a};\n            -webkit-clip-path: ${a};\n        `;this.innerShadow.style.cssText=g}drawOuterShadow(){const t=this.getRect(),e=this.convertToGlobal({x:this.shadow.pos.x,y:this.shadow.pos.y}),i=this.shadow.angle+3*Math.PI/2,s=1===this.getDirection()?this.shadow.width:0,n=0===this.getDirection()?"to right":"to left",r=[{x:0,y:0},{x:t.pageWidth,y:0},{x:t.pageWidth,y:t.height},{x:0,y:t.height}];let o="polygon( ";for(const t of r)if(null!==t){let e=1===this.getDirection()?{x:-t.x+this.shadow.pos.x,y:t.y-this.shadow.pos.y}:{x:t.x-this.shadow.pos.x,y:t.y-this.shadow.pos.y};e=h.GetRotatedPoint(e,{x:s,y:100},i),o+=e.x+"px "+e.y+"px, "}o=o.slice(0,-2),o+=")";const a=`\n            display: block;\n            z-index: ${(this.getSettings().startZIndex+10).toString(10)};\n            width: ${this.shadow.width}px;\n            height: ${2*t.height}px;\n            background: linear-gradient(${n}, rgba(0, 0, 0, ${this.shadow.opacity}), rgba(0, 0, 0, 0));\n            transform-origin: ${s}px 100px;\n            transform: translate3d(${e.x-s}px, ${e.y-100}px, 0) rotate(${i}rad);\n            clip-path: ${o};\n            -webkit-clip-path: ${o};\n        `;this.outerShadow.style.cssText=a}drawLeftPage(){"portrait"!==this.orientation&&null!==this.leftPage&&(1===this.direction&&null!==this.flippingPage&&"hard"===this.flippingPage.getDrawingDensity()?(this.leftPage.getElement().style.zIndex=(this.getSettings().startZIndex+5).toString(10),this.leftPage.setHardDrawingAngle(180+this.flippingPage.getHardAngle()),this.leftPage.draw(this.flippingPage.getDrawingDensity())):this.leftPage.simpleDraw(0))}drawRightPage(){null!==this.rightPage&&(0===this.direction&&null!==this.flippingPage&&"hard"===this.flippingPage.getDrawingDensity()?(this.rightPage.getElement().style.zIndex=(this.getSettings().startZIndex+5).toString(10),this.rightPage.setHardDrawingAngle(180+this.flippingPage.getHardAngle()),this.rightPage.draw(this.flippingPage.getDrawingDensity())):this.rightPage.simpleDraw(1))}drawBottomPage(){if(null===this.bottomPage)return;const t=null!=this.flippingPage?this.flippingPage.getDrawingDensity():null;"portrait"===this.orientation&&1===this.direction||(this.bottomPage.getElement().style.zIndex=(this.getSettings().startZIndex+3).toString(10),this.bottomPage.draw(t))}drawFrame(){this.clear(),this.drawLeftPage(),this.drawRightPage(),this.drawBottomPage(),null!=this.flippingPage&&(this.flippingPage.getElement().style.zIndex=(this.getSettings().startZIndex+5).toString(10),this.flippingPage.draw()),null!=this.shadow&&null!==this.flippingPage&&("soft"===this.flippingPage.getDrawingDensity()?(this.drawOuterShadow(),this.drawInnerShadow()):(this.drawHardOuterShadow(),this.drawHardInnerShadow()))}clear(){for(const t of this.app.getPageCollection().getPages())t!==this.leftPage&&t!==this.rightPage&&t!==this.flippingPage&&t!==this.bottomPage&&(t.getElement().style.cssText="display: none"),t.getTemporaryCopy()!==this.flippingPage&&t.hideTemporaryCopy()}update(){super.update(),null!==this.rightPage&&this.rightPage.setOrientation(1),null!==this.leftPage&&this.leftPage.setOrientation(0)}}class x{constructor(){this._default={startPage:0,size:"fixed",width:0,height:0,minWidth:0,maxWidth:0,minHeight:0,maxHeight:0,drawShadow:!0,flippingTime:1e3,usePortrait:!0,startZIndex:0,autoSize:!0,maxShadowOpacity:1,showCover:!1,mobileScrollSupport:!0,swipeDistance:30,clickEventForward:!0,useMouseEvents:!0,showPageCorners:!0,disableFlipByClick:!1}}getSettings(t){const e=this._default;if(Object.assign(e,t),"stretch"!==e.size&&"fixed"!==e.size)throw new Error('Invalid size type. Available only "fixed" and "stretch" value');if(e.width<=0||e.height<=0)throw new Error("Invalid width or height");if(e.flippingTime<=0)throw new Error("Invalid flipping time");return"stretch"===e.size?(e.minWidth<=0&&(e.minWidth=100),e.maxWidth<e.minWidth&&(e.maxWidth=2e3),e.minHeight<=0&&(e.minHeight=100),e.maxHeight<e.minHeight&&(e.maxHeight=2e3)):(e.minWidth=e.width,e.maxWidth=e.width,e.minHeight=e.height,e.maxHeight=e.height),e}}!function(t,e){void 0===e&&(e={});var i=e.insertAt;if(t&&"undefined"!=typeof document){var s=document.head||document.getElementsByTagName("head")[0],n=document.createElement("style");n.type="text/css","top"===i&&s.firstChild?s.insertBefore(n,s.firstChild):s.appendChild(n),n.styleSheet?n.styleSheet.cssText=t:n.appendChild(document.createTextNode(t))}}(".stf__parent {\n  position: relative;\n  display: block;\n  box-sizing: border-box;\n  transform: translateZ(0);\n\n  -ms-touch-action: pan-y;\n  touch-action: pan-y;\n}\n\n.sft__wrapper {\n  position: relative;\n  width: 100%;\n  box-sizing: border-box;\n}\n\n.stf__parent canvas {\n  position: absolute;\n  width: 100%;\n  height: 100%;\n  left: 0;\n  top: 0;\n}\n\n.stf__block {\n  position: absolute;\n  width: 100%;\n  height: 100%;\n  box-sizing: border-box;\n  perspective: 2000px;\n}\n\n.stf__item {\n  display: none;\n  position: absolute;\n  transform-style: preserve-3d;\n}\n\n.stf__outerShadow {\n  position: absolute;\n  left: 0;\n  top: 0;\n}\n\n.stf__innerShadow {\n  position: absolute;\n  left: 0;\n  top: 0;\n}\n\n.stf__hardShadow {\n  position: absolute;\n  left: 0;\n  top: 0;\n}\n\n.stf__hardInnerShadow {\n  position: absolute;\n  left: 0;\n  top: 0;\n}");t.PageFlip=class extends class{constructor(){this.events=new Map}on(t,e){return this.events.has(t)?this.events.get(t).push(e):this.events.set(t,[e]),this}off(t){this.events.delete(t)}trigger(t,e,i=null){if(this.events.has(t))for(const s of this.events.get(t))s({data:i,object:e})}}{constructor(t,e){super(),this.isUserTouch=!1,this.isUserMove=!1,this.setting=null,this.pages=null,this.setting=(new x).getSettings(e),this.block=t}destroy(){this.ui.destroy(),this.block.remove()}update(){this.render.update(),this.pages.show()}loadFromImages(t){this.ui=new u(this.block,this,this.setting);const e=this.ui.getCanvas();this.render=new d(this,this.setting,e),this.flipController=new g(this.render,this),this.pages=new n(this,this.render,t),this.pages.load(),this.render.start(),this.pages.show(this.setting.startPage),setTimeout(()=>{this.ui.update(),this.trigger("init",this,{page:this.setting.startPage,mode:this.render.getOrientation()})},1)}loadFromHTML(t){this.ui=new c(this.block,this,this.setting,t),this.render=new w(this,this.setting,this.ui.getDistElement()),this.flipController=new g(this.render,this),this.pages=new o(this,this.render,this.ui.getDistElement(),t),this.pages.load(),this.render.start(),this.pages.show(this.setting.startPage),setTimeout(()=>{this.ui.update(),this.trigger("init",this,{page:this.setting.startPage,mode:this.render.getOrientation()})},1)}updateFromImages(t){const e=this.pages.getCurrentPageIndex();this.pages.destroy(),this.pages=new n(this,this.render,t),this.pages.load(),this.pages.show(e),this.trigger("update",this,{page:e,mode:this.render.getOrientation()})}updateFromHtml(t){const e=this.pages.getCurrentPageIndex();this.pages.destroy(),this.pages=new o(this,this.render,this.ui.getDistElement(),t),this.pages.load(),this.ui.updateItems(t),this.render.reload(),this.pages.show(e),this.trigger("update",this,{page:e,mode:this.render.getOrientation()})}clear(){this.pages.destroy(),this.ui.clear()}turnToPrevPage(){this.pages.showPrev()}turnToNextPage(){this.pages.showNext()}turnToPage(t){this.pages.show(t)}flipNext(t="top"){this.flipController.flipNext(t)}flipPrev(t="top"){this.flipController.flipPrev(t)}flip(t,e="top"){this.flipController.flipToPage(t,e)}updateState(t){this.trigger("changeState",this,t)}updatePageIndex(t){this.trigger("flip",this,t)}updateOrientation(t){this.ui.setOrientationStyle(t),this.update(),this.trigger("changeOrientation",this,t)}getPageCount(){return this.pages.getPageCount()}getCurrentPageIndex(){return this.pages.getCurrentPageIndex()}getPage(t){return this.pages.getPage(t)}getRender(){return this.render}getFlipController(){return this.flipController}getOrientation(){return this.render.getOrientation()}getBoundsRect(){return this.render.getRect()}getSettings(){return this.setting}getUI(){return this.ui}getState(){return this.flipController.getState()}getPageCollection(){return this.pages}startUserTouch(t){this.mousePosition=t,this.isUserTouch=!0,this.isUserMove=!1}userMove(t,e){this.isUserTouch||e||!this.setting.showPageCorners?this.isUserTouch&&h.GetDistanceBetweenTwoPoint(this.mousePosition,t)>5&&(this.isUserMove=!0,this.flipController.fold(t)):this.flipController.showCorner(t)}userStop(t,e=!1){this.isUserTouch&&(this.isUserTouch=!1,e||(this.isUserMove?this.flipController.stopMove():this.flipController.flip(t)))}},Object.defineProperty(t,"__esModule",{value:!0})}));

/* ---- end StPageFlip ---- */

/* ---- Manual booklet (page-flip instruction-manual viewer) ------------
 * Ported from the Vermin_Booklet.html prototype (see its own
 * INTEGRATION.md for the full pitfalls list this code works around --
 * summarized inline at each relevant spot below, but read that file
 * before changing the stacking/sizing/blank-leaf logic). Generalized
 * from the prototype's single hardcoded device to any device via
 * MANUAL_BOOKLETS[deviceId] (an array of {key, crop, label} page
 * descriptors, one per LOGICAL page) plus that device's own name/model
 * already in DEVICES.
 *
 * Images are lazy-loaded per device from booklets/<device-id>.json (same
 * key->raw-base64-string shape as images_b64*.json, kept in the separate
 * MANUAL_IMG{} global rather than merged into IMG{}), fetched on the
 * "Manual" click for that device and cached after that. Nothing is
 * fetched at page boot the way the hero/box-art archive is -- see
 * ensureManualPagesLoaded()'s own comment.
 * ---------------------------------------------------------------------- */

// key -> raw base64 (no data: prefix), populated per device by
// ensureManualPagesLoaded().
window.MANUAL_IMG = window.MANUAL_IMG || {};

function manualImgSrc(key) {
  if (!key || !MANUAL_IMG[key]) return '';
  // Every manual scan is a plain JPEG -- unlike imgSrc() (which sniffs
  // .png/.svg/.webp keys for the hero/box-art archive), no extension
  // sniffing is needed here.
  return 'data:image/jpeg;base64,' + MANUAL_IMG[key];
}

// Fetches ONE device's manual pages, once (subsequent opens of the same
// device reuse the resolved promise), streaming so the caller can show real
// progress -- the same technique loadImageArchive() uses for the hero/box-art
// archive.
//
// Per device, not one archive for the site. This used to fetch three
// manuals_b64*.json chunks holding all 59 devices' scans -- ~80MB, and
// sequentially at that -- before a single page could be drawn, so opening any
// manual took ~8s and downloaded 58 manuals nobody asked for. (It also meant
// the first manual opened paid for every other one, which is why they all
// appeared to "load at once".) A device needs only its own pages: 1.6MB
// median, 3.4MB worst, 0.23MB best.
//
// Still not fetched at page boot the way the hero archive is: scanned manuals
// are a feature most visitors won't open every session, so they stay behind
// the "Manual" click.
const _manualPagePromises = new Map();

function ensureManualPagesLoaded(deviceId, onProgress) {
  if (_manualPagePromises.has(deviceId)) return _manualPagePromises.get(deviceId);
  const p = (async () => {
    try {
      Object.assign(window.MANUAL_IMG, await fetchBookletPages(deviceId, onProgress));
    } catch (e) {
      console.warn('Streaming fetch of ' + deviceId + ' manual failed, falling back to script tag:', e && e.message || e);
      Object.assign(window.MANUAL_IMG, await loadManualPagesViaScript(deviceId));
    }
  })();
  // A rejected load must not stay cached as "done", or the Manual button
  // would be dead for that device for the rest of the session.
  p.catch(() => _manualPagePromises.delete(deviceId));
  _manualPagePromises.set(deviceId, p);
  return p;
}

// onProgress(fraction, bytesReceived) -- fraction is null when the server
// didn't send a usable Content-Length.
async function fetchBookletPages(deviceId, onProgress) {
  const res = await fetch('booklets/' + encodeURIComponent(deviceId) + '.json');
  if (!res.ok) throw new Error('HTTP ' + res.status + ' loading ' + res.url);
  if (!res.body || !res.body.getReader) return res.json(); // no streams: still works, just no progress
  // NOTE: Content-Length is the COMPRESSED size when the server gzips (GitHub
  // Pages does), while the reader below yields decompressed bytes -- so this
  // fraction runs ahead of reality and is clamped at 99% by the caller rather
  // than being exact. base64'd JPEG only gzips to ~75%, so it's close enough
  // to be useful and never goes backwards. Same caveat as loadImageArchive().
  const total = +res.headers.get('Content-Length') || 0;
  const reader = res.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.length;
    if (onProgress) onProgress(total ? size / total : null, size);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) { body.set(c, offset); offset += c.length; }
  return JSON.parse(new TextDecoder().decode(body));
}

// Fallback for file:// (the browser blocks fetch of a local .json there) --
// same script-tag-sets-a-global technique loadImageArchiveViaScript() uses.
// Each booklets/<id>.js parks its pages under its own device id inside one
// shared object, so two devices loading at once can't clobber each other.
// No progress is possible on this path.
function loadManualPagesViaScript(deviceId) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'booklets/' + deviceId + '.js';
    s.onload = () => {
      const parts = window.__MANUAL_BOOKLET_PARTS || {};
      const pages = parts[deviceId];
      if (!pages) return reject(new Error('booklets/' + deviceId + '.js loaded but set no pages'));
      delete parts[deviceId]; // merged into MANUAL_IMG by the caller; don't hold a second copy
      resolve(pages);
    };
    s.onerror = () => reject(new Error('booklets/' + deviceId + '.js failed to load'));
    document.head.appendChild(s);
  });
}

(function () {
  let stageEl, bookEl = null, pageFlip = null;
  let currentPages = [];   // this open device's own MANUAL_BOOKLETS array
  let currentModel = '';

  // See INTEGRATION.md Pitfall #5: works around a real, open StPageFlip bug
  // (github.com/Nodlik/StPageFlip issue #49) -- padding the book with one
  // blank leaf before the front cover and after the back cover means every
  // transition, including opening/closing on a cover, is an ordinary
  // two-page turn, the only code path that behaves correctly.
  const blankBefore = { blank: true };
  const blankAfter = { blank: true };

  // Single-page (not spread) dimensions of the "virtual page" StPageFlip
  // lays out. The prototype hardcoded these to Vermin's own scan ratio
  // (480x318 => a single page of 1.51 h/w); that's right for the ~2.2-4.0
  // wide interior spreads every Wide Screen/Multi Screen/Panorama scan
  // comes in, but the four Tabletop manuals (Snoopy SM-73, Popeye PG-74,
  // DK Jr CJ-71, Cement Factory CM-72) are printed on much squarer paper --
  // their spreads scan at ~1.40 w/h, i.e. a single page taller than it is
  // wide. Forcing those into Vermin's page box squeezed each half-spread
  // down to fit the width and left both pages looking duplicated/unreadable
  // (confirmed live). So the page box is derived per book from that title's
  // own first interior spread instead, with Vermin's numbers as the default
  // for anything that can't be measured. Height is what stays fixed
  // (BASE_H); width follows from the real ratio, so a squarer book gets a
  // narrower page rather than a squashed one.
  const BASE_H = 318, BASE_MINH = 186, BASE_MAXH = 517;
  const DEFAULT_PAGE_W = 480; // Vermin's own single-page width at BASE_H
  let pageW = DEFAULT_PAGE_W;

  // spreadRatio = full spread width/height. One page is half that width, so
  // pageW = BASE_H * (spreadRatio / 2). Measured off the real decoded image
  // rather than declared per-title, so it can never drift from the scans.
  function measurePageWidth(pages) {
    const spread = pages.find(p => p.crop === 'left');
    if (!spread) return DEFAULT_PAGE_W;
    const b64 = MANUAL_IMG[spread.key];
    if (!b64) return DEFAULT_PAGE_W;
    return new Promise(resolve => {
      const img = new Image();
      img.onload = () => {
        if (!img.naturalWidth || !img.naturalHeight) return resolve(DEFAULT_PAGE_W);
        resolve(BASE_H * ((img.naturalWidth / img.naturalHeight) / 2));
      };
      img.onerror = () => resolve(DEFAULT_PAGE_W);
      img.src = 'data:image/jpeg;base64,' + b64;
    });
  }

  // Builds a fresh #manual-book + StPageFlip instance at the given zoom
  // scale (1 or 2). Also used for the very first open. StPageFlip has no
  // public "resize" call that actually re-measures its container -- the
  // book's min/max-width are baked into the DOM once at construction time
  // -- so growing it for a real 2x zoom, or switching to a different
  // device's manual, means tearing the instance down and rebuilding fresh
  // (INTEGRATION.md Pitfall #2).
  function buildBook(scale, startIndex) {
    if (pageFlip) {
      pageFlip.destroy(); // removes the old #manual-book (and its listeners) entirely
    }
    // Always construct against an un-scrollbarred stage. Left over from a
    // previous device/zoom, .is-scrollable's scrollbar would still be
    // occupying ~10px of stage width at the moment StPageFlip measures its
    // container -- and that measurement is permanent (Pitfall #2/#3). The
    // rAF below re-adds the class if this book actually needs it.
    if (stageEl) stageEl.classList.remove('is-scrollable');
    bookEl = document.createElement('div');
    bookEl.id = 'manual-book';
    stageEl.appendChild(bookEl);

    const domPages = [blankBefore].concat(currentPages, [blankAfter]);

    domPages.forEach((page) => {
      const div = document.createElement('div');

      if (page.blank) {
        div.className = 'manual-page blank';
        const blankImg = document.createElement('img');
        blankImg.className = 'manual-pageimg';
        // A real, OPAQUE 1x1 PNG (color-matched to the page background), not
        // an empty div and not a transparent one -- StPageFlip keeps the
        // outgoing spread's pages rendered underneath (lower z-index) for
        // the whole flip, only swapping them out once it completes, so this
        // "blank" leaf is what visually covers that stale content while
        // it's on top. Transparent would let the old page show straight
        // through, which looks exactly like a duplicated page.
        blankImg.src = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGOQkRT7DwAB6wFLlGYSeQAAAABJRU5ErkJggg==';
        blankImg.draggable = false;
        blankImg.style.width = '100%';
        blankImg.style.height = '100%';
        blankImg.style.position = 'absolute';
        blankImg.style.left = '0';
        blankImg.style.top = '0';
        div.appendChild(blankImg);
        bookEl.appendChild(div);
        return;
      }

      div.className = 'manual-page';

      const img = document.createElement('img');
      img.className = 'manual-pageimg';
      img.src = manualImgSrc(page.key);
      img.draggable = false;
      if (page.crop === 'full') {
        img.style.left = '50%';
        img.style.transform = 'translateX(-50%)';
        img.style.width = '100%';
        img.style.height = '100%';
        img.style.objectFit = 'cover';
        img.style.position = 'absolute';
      } else if (page.crop === 'left') {
        img.style.left = '0';
      } else {
        img.style.right = '0';
      }
      div.appendChild(img);

      const shade = document.createElement('div');
      shade.className = 'manual-page-shade';
      div.appendChild(shade);

      bookEl.appendChild(div);
    });

    // min/max width scale with this book's own page width (see pageW /
    // measurePageWidth above) so the same 0.58x-1.63x latitude the
    // prototype's hardcoded 280/780 gave Vermin's 480 applies to every
    // book's real page shape, rather than clamping a squarer Tabletop page
    // back out to Vermin's proportions.
    const minW = pageW * (280 / DEFAULT_PAGE_W);
    const maxW = pageW * (780 / DEFAULT_PAGE_W);

    // StPageFlip will not draw a spread narrower than 2 * minWidth, whatever
    // the container says -- `size: 'stretch'` stretches to the parent but
    // stops dead at that floor. On a phone the floor is wider than the stage
    // itself (measured: a 390px-wide window gives a 340px stage, and the
    // book still renders 566px = 2 x 283), so the stage overflows sideways,
    // updateStageScrolling flips it to .is-scrollable, and that boxes the
    // page in -- a dragged page can no longer swing out past the book's
    // edges, which is most of what makes it read as a real booklet. That was
    // fixed on desktop by scoping .is-scrollable to the doesn't-fit case;
    // mobile just never fits, so it was permanently in the clipped mode.
    //
    // So shrink the WHOLE book uniformly until the narrowest spread it is
    // willing to draw fits the stage. Uniform (one factor applied to all six
    // numbers) keeps every ratio and the min/max latitude intact -- a book
    // that merely fits, rather than a squashed one.
    //
    // 1x only, and only when it doesn't fit. At 2x the whole point is a book
    // bigger than the stage that you scroll around to read, so it keeps its
    // real floor and goes on clipping, exactly as 2x already does on
    // desktop. And any viewport wide enough for the floor (~560px+, i.e.
    // every desktop and tablet) computes eff === scale and is untouched.
    let eff = scale;
    const stageW = stageEl ? stageEl.clientWidth : 0;
    if (scale === 1 && stageW) {
      const narrowest = 2 * minW * scale;
      if (narrowest > stageW) eff = scale * (stageW / narrowest);
    }

    pageFlip = new St.PageFlip(bookEl, {
      width: pageW * eff,
      height: BASE_H * eff,
      size: 'stretch',
      minWidth: minW * eff,
      maxWidth: maxW * eff,
      minHeight: BASE_MINH * eff,
      maxHeight: BASE_MAXH * eff,
      maxShadowOpacity: 0.5,
      showCover: false,
      // Always render as a two-page spread -- StPageFlip's own portrait/
      // landscape auto-switch (a live width measurement) can race the
      // browser's layout pass right after a zoom rebuild and collapse to a
      // single visible page (INTEGRATION.md Pitfall #4).
      usePortrait: false,
      flippingTime: 900,
      mobileScrollSupport: false
    });

    pageFlip.loadFromHTML(bookEl.querySelectorAll('.manual-page'));
    pageFlip.on('flip', updateManualUI);
    // StPageFlip settles its own orientation/bounds measurement
    // asynchronously (loadFromHTML defers part of its setup by one tick
    // before firing 'init') -- jumping to startIndex synchronously right
    // after loadFromHTML returns races that settle step.
    pageFlip.on('init', () => {
      if (startIndex) pageFlip.turnToPage(startIndex);
      updateManualUI();
    });

    // One more render update a couple of frames later self-corrects any
    // stale size StPageFlip's very first bounds measurement baked in
    // before the browser fully settled the layout from the CSS changes
    // just made (window/stage resizing for the zoom toggle).
    const flipAtSchedule = pageFlip;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (pageFlip === flipAtSchedule) {
          pageFlip.getRender().update();
          // First pass once that final render update has settled the real
          // size. The ResizeObserver below is what makes this robust rather
          // than a timing guess -- see its own comment.
          updateStageScrolling();
          if (stageResizeObs) {
            stageResizeObs.disconnect(); // bookEl is recreated every build
            stageResizeObs.observe(stageEl);
            stageResizeObs.observe(bookEl);
          }
        }
      });
    });
  }

  // The stage only becomes a scroll container when the built book genuinely
  // doesn't fit it -- see the .is-scrollable CSS for the full reasoning and
  // for what that trade costs. Everywhere else the stage stays
  // overflow:visible so a turning/dragged page can swing outside the book's
  // edges the way a real book does. Measured rather than hardcoded to "2x"
  // or "Tabletop": whether a book fits depends on its own page shape AND the
  // viewport, so a short window can push other titles over the line too.
  // Only worth scrolling once a MEANINGFUL slice of the page is out of
  // reach, because turning scrolling on costs the free-swinging page turn
  // (see the .is-scrollable CSS). Measured at 2x: a Tabletop title
  // overflows by ~500px and is genuinely unreadable without scrolling,
  // whereas a normal landscape title overflows by ~8px of StPageFlip's own
  // internal slack -- boxing the flip to recover 8px would be a bad trade.
  const OVERFLOW_SLACK_PX = 32;

  function updateStageScrolling() {
    if (!stageEl) return;
    // Measure the STAGE's own overflow, not #manual-book's: the book is a
    // flex child and (while not .is-scrollable) gets stretched to exactly
    // the stage's height, so comparing the two always reads ~0 and this
    // could never fire. StPageFlip's real content lives in an inner
    // .stf__wrapper that can be taller than #manual-book itself; the
    // stage's scrollHeight accounts for it whatever the culprit.
    // Safe to read here because this only runs at rest, right after a
    // build -- mid-flip the same numbers are full of phantom overflow (see
    // the .is-scrollable CSS).
    const over = Math.max(
      stageEl.scrollHeight - stageEl.clientHeight,
      stageEl.scrollWidth - stageEl.clientWidth
    );
    stageEl.classList.toggle('is-scrollable', over > OVERFLOW_SLACK_PX);
  }

  // Re-check whenever the stage or the book actually changes size. The
  // rAF pass above catches the normal case, but it's still a guess at when
  // layout has settled: closing one book and opening another in quick
  // succession was observed measuring while the stage was still sized to
  // the PREVIOUS book, latching the wrong answer with nothing to correct
  // it. This makes the decision self-correcting instead of timing-based,
  // and also covers window resizes, which nothing else here handles.
  // Deliberately observes only these two elements' own boxes -- a page turn
  // resizes StPageFlip's internals, not these, so flips don't retrigger it
  // (which matters: mid-flip measurements are full of phantom overflow).
  const stageResizeObs = typeof ResizeObserver === 'function'
    ? new ResizeObserver(() => updateStageScrolling())
    : null;

  let overlay, windowEl, subtitleEl, titleEl, dotsWrap, prevBtn, nextBtn, zoom1Btn, zoom2Btn, closeBtn;
  let dotEls = [];
  let numStates = 0;

  function stateFromIndex(idx) { return Math.floor(idx / 2); }

  // The page-section label lives in the window's subtitle line, rebuilt on
  // every page turn.
  function updateManualUI() {
    const idx = pageFlip.getCurrentPageIndex();
    const state = stateFromIndex(idx);
    dotEls.forEach((dot, i) => dot.classList.toggle('active', i === state));

    let section;
    if (state === 0) {
      section = currentPages[0].label;
    } else if (state === numStates - 1) {
      section = currentPages[currentPages.length - 1].label;
    } else {
      const left = currentPages[2 * state - 1];
      const right = currentPages[2 * state];
      // Some spreads are one topic continued across two pages (e.g.
      // "Cautions" on both halves) rather than two distinct topics -- don't
      // repeat the label in that case (INTEGRATION.md Pitfall #7).
      section = left.label === right.label ? left.label : left.label + ' · ' + right.label;
    }
    subtitleEl.textContent = 'Instruction Manual · ' + currentModel + ' · ' + section;
    prevBtn.disabled = state <= 0;
    nextBtn.disabled = state >= numStates - 1;
  }

  function setManualZoom(scale) {
    const isZoomed = windowEl.classList.contains('zoomed');
    if (scale === (isZoomed ? 2 : 1)) return;
    const idx = pageFlip.getCurrentPageIndex();
    windowEl.classList.toggle('zoomed', scale === 2);
    zoom1Btn.classList.toggle('active', scale === 1);
    zoom2Btn.classList.toggle('active', scale === 2);
    // Force the browser to apply the width/max-width change from the class
    // toggle above synchronously (INTEGRATION.md Pitfall #3) -- without
    // this, StPageFlip's first size measurement inside buildBook (also
    // synchronous, later in this same tick) can still see the OLD
    // pre-toggle dimensions.
    void windowEl.offsetWidth;
    buildBook(scale, idx);
  }

  // A manual can be opened either from a device tile (nothing behind it but
  // the collection grid) or from the already-open device slide-out (an
  // .overlay behind it, itself ~75% dark with its own blur(8px)). Stacking
  // this overlay's own ~75% dark layer on top of that one compounds to
  // ~94% -- solid black rather than a blurred backdrop, which is the bug
  // this whole dance exists to avoid.
  //
  // Only the dark background is the problem; blur compounds harmlessly. So
  // when something IS open behind us, we drop just our own background and
  // keep our blur (see .manual-overlay.stacked). The grid then ends up
  // dimmed by .75 either way -- by us from a tile, by the slide-out from
  // there -- so both entry points look the same, which was always the goal.
  //
  // The previous approach stripped the underlying overlay's backdrop
  // instead, and restored it on close. Same end state, but it snapped the
  // grid sharp for a frame and re-blurred it as this overlay faded in: a
  // visible unblur/reblur flash on every open. Changing nothing underneath
  // leaves no such transition to get wrong. index.html's #lightbox-overlay
  // does the same thing (it's always stacked, so it drops its background
  // unconditionally rather than needing this check).
  function markStacked() {
    const stacked = Array.from(document.querySelectorAll('.overlay.open')).some(el => el !== overlay);
    overlay.classList.toggle('stacked', stacked);
  }

  // Exposed on window because index.html's closeOverlay() hands off to it
  // for #manualOverlay -- the global Escape/route-change sweeps go through
  // closeOverlay(), and this modal needs its own teardown, not just having
  // .open stripped.
  window.closeManualBooklet = function closeManualBooklet() {
    if (!overlay) return; // never opened, nothing to tear down
    overlay.classList.remove('open');
    document.body.style.overflow = '';
    // Left set until the next open recomputes it would be a stale answer if
    // the booklet were next opened from a different entry point.
    overlay.classList.remove('stacked');
  };
  const closeManualBooklet = window.closeManualBooklet;

  let _manualInit = false;
  function initManualDomRefs() {
    if (_manualInit) return;
    _manualInit = true;
    overlay = document.getElementById('manualOverlay');
    windowEl = overlay.querySelector('.manual-window');
    titleEl = document.getElementById('manualTitle');
    subtitleEl = document.getElementById('manualSubtitle');
    stageEl = document.getElementById('manualStage');
    dotsWrap = document.getElementById('manualDots');
    prevBtn = document.getElementById('manualPrevBtn');
    nextBtn = document.getElementById('manualNextBtn');
    zoom1Btn = document.getElementById('manualZoom1Btn');
    zoom2Btn = document.getElementById('manualZoom2Btn');
    closeBtn = document.getElementById('manualCloseBtn');

    prevBtn.addEventListener('click', () => pageFlip.flipPrev());
    nextBtn.addEventListener('click', () => pageFlip.flipNext());
    zoom1Btn.addEventListener('click', () => setManualZoom(1));
    zoom2Btn.addEventListener('click', () => setManualZoom(2));
    closeBtn.addEventListener('click', closeManualBooklet);

    // Click-outside-to-close, but only when the press itself started on the
    // backdrop (INTEGRATION.md Pitfall #6) -- a page drag that starts on
    // the book and releases over the backdrop fires a synthetic click on
    // the overlay too, which would otherwise close the modal mid-drag.
    let pressStartedOnSelf = false;
    overlay.addEventListener('mousedown', (e) => { pressStartedOnSelf = (e.target === overlay); });
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay && pressStartedOnSelf) closeManualBooklet();
      pressStartedOnSelf = false;
    });

    document.addEventListener('keydown', (e) => {
      if (!overlay.classList.contains('open')) return;
      if (e.key === 'ArrowRight') pageFlip.flipNext();
      else if (e.key === 'ArrowLeft') pageFlip.flipPrev();
      else if (e.key === 'Escape') closeManualBooklet();
    });
  }

  // Progress UI for the one genuine wait in this modal: fetching a device's
  // scans (1.6MB median) the first time its manual is opened. Near-instant on
  // broadband, but it earns its keep on mobile data and on the 3MB+ Crystal
  // Screen manuals. Mounted into the stage, which buildBook() clears before
  // it measures anything (Pitfall #2), so this can't affect the book's size.
  //
  // Returns {update, done, fail} rather than touching module state, so a
  // stale open (the user clicking through several manuals quickly) can simply
  // be ignored by its caller instead of racing the current one's UI.
  function showManualLoading(device) {
    const wrap = document.createElement('div');
    wrap.className = 'manual-loading';
    wrap.innerHTML =
      '<div class="manual-loading-bar"><div class="manual-loading-fill"></div></div>' +
      '<div class="manual-loading-stat">Connecting…</div>';
    stageEl.appendChild(wrap);
    const fill = wrap.querySelector('.manual-loading-fill');
    const stat = wrap.querySelector('.manual-loading-stat');
    const label = (suffix) => 'Instruction Manual · ' + device.model + ' · ' + suffix;

    return {
      // fraction may be null when Content-Length was missing -- then all we
      // can honestly report is how much has arrived.
      update(fraction, bytes) {
        const mb = (bytes / 1048576).toFixed(1);
        if (fraction === null) {
          stat.textContent = mb + ' MB';
          subtitleEl.textContent = label('Loading… ' + mb + ' MB');
          return;
        }
        // Clamped at 99: Content-Length is the gzipped size, so the true
        // fraction overshoots 1 well before the last bytes land. Better a bar
        // that waits at 99% than one that sits at 100% still loading.
        const pct = Math.min(99, Math.round(fraction * 100));
        fill.style.width = pct + '%';
        stat.textContent = pct + '% · ' + mb + ' MB';
        subtitleEl.textContent = label('Loading… ' + pct + '%');
      },
      done() { fill.style.width = '100%'; stat.textContent = 'Preparing pages…'; },
      fail() { wrap.classList.add('failed'); stat.textContent = 'Could not load this manual.'; }
    };
  }

  // device = the DEVICES[] entry; pages = MANUAL_BOOKLETS[device.id].
  window.openManualBooklet = async function (device, pages) {
    initManualDomRefs();
    titleEl.textContent = device.name + ' — Game & Watch';
    currentModel = device.model;
    currentPages = pages;
    numStates = Math.ceil((pages.length + 2) / 2);

    // Before .open, so the correct backdrop is in place on the very first
    // frame the overlay becomes visible.
    markStacked();
    overlay.classList.add('open');
    document.body.style.overflow = 'hidden';
    subtitleEl.textContent = 'Instruction Manual · ' + device.model + ' · Loading…';
    stageEl.innerHTML = '';
    // Park the controls while there's no book behind them. Both are rebuilt
    // below once the real one exists. Without this they keep the PREVIOUS
    // device's dots and enabled arrows, still wired to a pageFlip whose DOM
    // was just cleared -- clicking Next there quietly drives a destroyed
    // book instead of doing nothing. (The old all-devices-at-once archive
    // left that live for the whole ~8s load; per-device shrinks the window
    // to a few hundred ms but doesn't close it.)
    dotsWrap.innerHTML = '';
    dotEls = [];
    prevBtn.disabled = true;
    nextBtn.disabled = true;

    // Only this device's pages, and only the first time it's opened. A
    // cached device resolves in the same tick, so the progress UI below
    // never gets a chance to flash -- it's for the genuine first fetch.
    const progress = _manualPagePromises.has(device.id) ? null : showManualLoading(device);
    try {
      await ensureManualPagesLoaded(device.id, progress ? progress.update : null);
    } catch (e) {
      // Stale open? Then the newer one owns the UI -- say nothing.
      if (!overlay.classList.contains('open') || currentPages !== pages) return;
      if (progress) progress.fail();
      subtitleEl.textContent = 'Instruction Manual · ' + device.model + ' · Unavailable';
      console.warn('Manual for ' + device.id + ' could not be loaded:', e && e.message || e);
      return;
    }
    if (progress) progress.done();
    // Per-book page shape -- must be measured before buildBook(), since
    // StPageFlip bakes its dimensions in at construction (Pitfall #2).
    pageW = await measurePageWidth(pages);

    // A second device's manual can be opened (or the same one re-opened)
    // while a previous build is still settling -- the awaits above mean the
    // overlay could have been closed, or another device opened, by the time
    // we get here.
    if (!overlay.classList.contains('open') || currentPages !== pages) return;
    stageEl.innerHTML = ''; // drop the loading UI before StPageFlip measures the stage

    dotsWrap.innerHTML = '';
    dotEls = [];
    for (let d = 0; d < numStates; d++) {
      const dot = document.createElement('div');
      dot.className = 'manual-dot';
      dotsWrap.appendChild(dot);
      dotEls.push(dot);
    }

    buildBook(windowEl.classList.contains('zoomed') ? 2 : 1, 0);
  };
})();

/* globals Croquet */

/**

    DrawingModel keeps the data structure for multiple drawing pages in the `drawings` property. When a page change is requested, the corresponding data in "drawings" is assigned into the instance of DrawingCanvasModel.

   A stroke object looks like following but we use a equivalent plain JS object as it is only data

class Stroke {
    constructor() {
        this.done = true;
        this.segments = [];
    }

    addSegment(segment) {
        this.segments.push(segment);
    }

    undo() {
        this.done = false;
    }

    redo() {
        this.done = true;
    }
}

strokeLists is a Map keyed by the viewId so that undo request from a user can be handled.
globals is an ordered list that stores all strokes since the beginning of the session.

A $-property strokeData is used to cache the persitent data keyed by the key of the picture.

DrawingBackground model and view provides a shell for DrawingCanvas model and view. DrawingCavnvas simply provides the features to draw on a single canvas. DrawingBackground provides the scaling and showing/hiding based on the requirement from outside.

*/

class DrawingModel {
    init() {
        this.subscribe(this.sessionId, "view-exit", "viewExit");
        this.subscribe(this.sessionId, "triggerPersist", "triggerPersist");
        this.subscribe(this.sessionId, "goingToImage", "goingToImage");
        this.subscribe(this.sessionId, "imageRemoved", "imageRemoved");
        this.subscribe(this.id, "resetStrokeData", "resetStrokeData");

        if (!this._get("drawings")) {
            let drawing = {width: 2048, height: 2048, global: [], strokeLists: new Map(), key: 0};
            this._set("drawings", new Map([[0, drawing]]));

            let background = this.createElement("div");
            background.domId = "background";
            background.setCode("drawing.DrawingBackgroundModel");
            background.setViewCode("drawing.DrawingBackgroundView");
            this.appendChild(background);

            let canvas = this.createElement("canvas");
            canvas.domId = "canvas";
            canvas.setCode("drawing.DrawingCanvasModel");
            canvas.setViewCode("drawing.DrawingCanvasView");
            background.appendChild(canvas);
            canvas.call("DrawingCanvasModel", "setData", drawing);
            canvas._set("parentId", this.id);

            let buttonRow = this.createElement();
            buttonRow.domId = "buttonRow";
            buttonRow.classList.add("buttonRow");
            buttonRow.setCode("drawing.ButtonRowModel");
            buttonRow.setViewCode("drawing.ButtonRowView");
            this.appendChild(buttonRow);
        }

        if (this._get("lastPersistTime") === undefined) {
            this._set("lastPersistTime", 0);
        }

        this.$strokeData = new Map(); // {key<number> -> data<string>}

        let canvas = this.querySelector("#canvas");
        let buttonRow = this.querySelector("#buttonRow");
        buttonRow.call("ButtonRowModel", "setDrawerId", canvas.id);
        console.log("DrawingModel.init");
    }

    viewExit(viewId) {
        let drawings = this._get("drawings");
        for (let drawing of drawings.values()) {
            let map = drawing["strokeList"];
            if (map) {
                delete map[viewId];
            }
        }
    }

    triggerPersist() {
        const now = this.now();
        if (now - this._get("lastPersistTime") < 30000) {return;}
        // console.log("write", now);
        this._set("lastPersistTime", now);
        this.savePersistentData();
    }

    loadWhiteBoardNoPagesPersistentData(data) {
        let dataLines = data.lines;

        let newGlobal = [];

        for (let i = 0; i < dataLines.length; i++) {
            let info = dataLines[i];
            let {color, lineWidth, viewId} = info.lineInfo;
            let lines = info.lines;
            let lastPoint;
            let stroke;
            for (let j = 0; j < lines.length; j++) {
                let currentPoint = lines[j];
                if (j === 0) {
                    stroke = {done: true, segments: []};
                    newGlobal.push(stroke);
                } else {
                    let segment = {
                        x0: lastPoint[0],
                        y0: lastPoint[1],
                        x1: currentPoint[0],
                        y1: currentPoint[1],
                        color,
                        nib: lineWidth,
                        under: false,
                        viewId
                    };

                    stroke.segments.push(segment);
                }
                lastPoint = currentPoint;
            }
        }

        let drawing = {width: 2048, height: 2048, global: newGlobal, strokeLists: new Map(), key: 0};
        this._set("drawings", new Map([[0,drawing]]));
    }

    loadPersistentData(data) {
        let top = this.wellKnownModel("modelRoot");
        if (data.version === "whiteboard-nopages") {
            this.loadWhiteBoardNoPagesPersistentData(data);
        } else if (data.version === "1") {
            let obj = top.parse(data.data);
            this._set("drawings", obj);
        }
        this.goingToImage({key: 0, width: this._get("width"), height: this._get("height")});
    }

    savePersistentData() {
        let top = this.wellKnownModel("modelRoot");
        let func = () => {
            let drawings = this._get("drawings");

            let savedDrawings = new Map();

            drawings.forEach((drawing, k) => {
                let newGlobal = drawing.global.filter(s => s.done);
                savedDrawings.set(k, {...drawing, global: newGlobal});
            });
            return {data: top.stringify(savedDrawings), version: "1"};
        };
        top.persistSession(func);
    }

    resetStrokeData(key) {
        if (this.$strokeData) {
            this.$strokeData.delete(key);
        }
    }

    goingToImage(data) {
        let {key, width, height} = data;
        let drawings = this._get("drawings");
        let drawing = drawings.get(key);

        if (!drawing) {
            drawing = {width, height, global: [], strokeLists: new Map(), key};
            drawings.set(key, drawing);
        }

        let canvas = this.querySelector("#canvas");
        // let background = this.querySelector("#background");

        canvas.call("DrawingCanvasModel", "setData", drawing);
        canvas.classList.remove("no-picture");
        this.style.setProperty("background-color", "transparent");

        // background.call("DrawingBackgroundModel", "setBackground", noPicture ? "white" : "transparent", width, height);
    }

    imageRemoved(key) {
        this.resetStrokeData(key);
        let drawings = this._get("drawings");
        drawings.delete(key);
    }
}

class DrawingBackgroundModel {
    init() {
        console.log("DrawingBackgroundModel");
    }

    setBackground(color, width, height) {
        this.style.setProperty("background-color", color);
        this.style.setProperty("width", width);
        this.style.setProperty("height", height);
    }
}

class DrawingBackgroundView {
    init() {
        this.subscribe(this.sessionId, "imageLoadStarted", "hideDrawing");
        this.subscribe(this.sessionId, "imageLoaded", "showDrawing");
        this.canvas = this.querySelector("#canvas");
        this.scale = 1;
        this.width = 1024;
        this.height = 1024;
        let Messenger = Croquet.Messenger;

        if (window.parent !== window) {
            // assume that we're embedded in Greenlight
            Messenger.setReceiver(this);
            Messenger.send("appReady");
            Messenger.on("appInfoRequest", () => {
                Messenger.send("appInfo", {
                    appName: "whiteboard",
                    label: "whiteboard",
                    iconName: "whiteboard.svgIcon",
                    /* eslint-disable-next-line */
                    urlTemplate: "../whiteboard/?q=${q}",
                    transparent: true
                });
            });
            Messenger.startPublishingPointerMove();
        }
        console.log("DrawingBackgroundView.init");
    }


    resizeWindow() {
        let images = this.model._get("images");
        let entry = images[this.model._get("index")];
        if (entry) {
            this.resizeAndPositionImages(entry.width, entry.height);
            this.publishImageLoaded();
        }
    }

    hideDrawing() {
        let canvas = this.canvas;
        canvas.dom.style.setProperty("display", "none");
        this.timeout = setTimeout(() => {
            this.timeout = 0;
            canvas.dom.style.removeProperty("display");
        }, 5000);
    }

    showDrawing(data) {
        let {translation, width, height, key} = data;
        let canvas = this.canvas;

        canvas.call("DrawingCanvasView", "enable", key !== 0);

        this.resizeImage(width, height);
        this.setScaleAndTranslation(width, height, translation.x, translation.y);
        if (this.timeout) {
            clearTimeout(this.timeout);
            this.timeout = 0;
        }

        canvas.call("DrawingCanvasView", "resizeAndDraw");
        canvas.dom.style.removeProperty("display");
    }

    resizeImage(width, height) {
        let rect = this.dom.parentNode.getBoundingClientRect();
        let scale = Math.min(rect.width / width, rect.height / height);

        this.scale = scale;

        [this.canvas].forEach(img => {
            img.dom.style.setProperty("width", `${width}px`);
            img.dom.style.setProperty("height", `${height}px`);
        });
    }

    setScaleAndTranslation(width, height, tx, ty) {
        this.translation = {x: tx, y: ty};
        this.positionImage(width, height);
    }

    positionImage(width, height) {
        let tx;
        let ty;
        let scale = this.scale;
        let rect = this.dom.parentNode.getBoundingClientRect();
        tx = (rect.width - scale * width) / 2;
        ty = (rect.height - scale * height) / 2;
        this.translation = {x: tx, y: ty};

        this.dom.style.setProperty("transform", `translate(${tx}px, ${ty}px) scale(${scale})`);
        this.dom.style.setProperty("transform-origin", `0px 0px`);
    }
}

class DrawingCanvasModel {
    init() {
        this.subscribe(this.sessionId, "view-exit", "viewExit");

        this.subscribe(this.id, "startLine", "startLine");
        this.subscribe(this.id, "addLine", "addLine");
        this.subscribe(this.id, "undo", "undo");
        this.subscribe(this.id, "redo", "redo");
        this.subscribe(this.id, "clear", "clear");
        if (!this._get("global")) {
            this._set("global", []);
            this._set("strokeLists", new Map());
            this._set("width", 0);
            this._set("height", 0);
            this._set("key", 0);
        }

        console.log("DrawingCanvasModel.init");
    }

    setData(data) {
        let {global, strokeLists, width, height, key} = data;
        this._set("global", global);
        this._set("strokeLists", strokeLists);
        this._set("width", width);
        this._set("height", height);
        this._set("key", key);
    }

    viewExit(viewId) {
        this._get("strokeLists").delete(viewId);
    }

    startLine(key) {
        this.publish(this._get("parentId"), "resetStrokeData", key);
    }

    addLine(data) {
        let {viewId, x0, y0, x1, y1, color, nib, under, isNew, key} = data;

        if (this._get("key") !== key) {return;} // if a page is turned the stroke should be discarded

        let global = this._get("global");
        let strokeLists = this._get("strokeLists");
        let strokes = strokeLists.get(viewId);
        if (!strokes) {
            strokes = [];
            strokeLists.set(viewId, strokes);
        }

        let stroke;
        if (isNew) {
            stroke = {done: true, segments: []};
            global.push(stroke);
            strokes.push(stroke);
        } else {
            stroke = strokes[strokes.length - 1];
        }

        let segment = {x0, y0, x1, y1, color, nib, under, viewId};
        stroke.segments.push(segment);
        this.publish(this.id, "drawLine", segment);
    }

    undo(viewId) {
        let strokeLists = this._get("strokeLists");
        let strokes = strokeLists.get(viewId);

        let findLast = () => {
            if (!strokes) {return -1;}
            for (let i = strokes.length - 1; i >= 0; i--) {
                if (strokes[i].done) {return i;}
            }
            return -1;
        };

        let index = findLast();
        if (index >= 0) {
            strokes[index].done = false;
            this.publish(this.id, "drawAll");
        }
    }

    redo(viewId) {
        let strokeLists = this._get("strokeLists");
        let strokes = strokeLists.get(viewId);

        let find = () => {
            if (!strokes) {return -1;}
            if (strokes.length === 0) {return -1;}
            if (strokes.length === 1) {return strokes[0].done ? -1 : 0;}
            for (let i = strokes.length - 1; i >= 1; i--) {
                if (strokes[i].done) {return -1;}
                if (!strokes[i].done && strokes[i - 1].done) {return i;}
            }
            return 0;
        };

        let index = find();
        if (index >= 0) {
            strokes[index].done = true;
            this.publish(this.id, "drawAll");
        }
    }

    clear(_viewId) {
        this._get("global").length = 0;
        this._get("strokeLists").clear();
        this.publish(this.id, "drawAll");
    }
}

class DrawingCanvasView {
    init() {
        this.subscribe(this.model.id, "drawLine", "drawLineAndMove");
        this.subscribe(this.model.id, "drawAll", "drawAll");
        this.subscribe(this.model.id, "resizeAndDraw", "resizeAndDraw");
        this.subscribe(this.model.id, "colorSelected", "colorSelected");
        this.subscribe(this.model.id, "nibSelected", "nibSelected");

        this.color = "black";
        this.nib = 8;
        this.addEventListener("pointerdown", "pointerDown");

        this.resizeAndDraw();

        this.glShell = window.glShell;
        this.iframed = window.parent !== window;

        window.onresize = () => {
            this.resizeWindow();
        };

        console.log("DrawingCanvasView.init");
    }

    detach() {
        super.detach();
        window.onresize = null;
        this.scalerKey = null;
    }

    resizeWindow() {
        this.resizeAndDraw();
    }

    resize(width, height) {
        if (this.dom.getAttribute("width") !== `${width}`
            || this.dom.getAttribute("height") !== `${height}`) {
            this.dom.setAttribute("width", width);
            this.dom.setAttribute("height", height);
        }
    }

    resizeAndDraw() {
        let width = this.model._get("width");
        let height = this.model._get("height");
        if (width && height) {
            this.resize(width, height);
        }

        this.drawAll();
    }

    colorSelected(color) {
        this.color = color;
    }

    nibSelected(nib) {
        this.nib = nib;
    }

    clear() {
        let canvas = this.dom;
        let ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
    }

    drawAll() {
        let global = this.model._get("global");
        if (!global) {return;}
        this.clear();
        this.drawStrokes(global);
    }

    drawStrokes(strokes) {
        strokes.forEach((stroke) => {
            if (!stroke.done) {return;}
            stroke.segments.forEach((segment) => {
                this.drawLine(segment);
            });
        });
    }

    drawLineAndMove(segment) {
        this.drawLine(segment);

        let {x1, y1, viewId} = segment;
        if (this.viewId === viewId) {return;}
        if (!this.scalerKey) {
            let scaler = window.topView.querySelector("#scaler");
            if (scaler) {
                this.scaler = scaler;
                this.scalerKey = scaler.model.asElementRef().asKey();
            }
        }
        if (this.glShell && !this.iframed && this.scalerKey) {
            this.scaler.call("RemoteCursorView", "pointerMoved", {target: this.scalerKey, x: x1, y: y1, viewId});
        }
    }

    drawLine(segment) {
        let {x0, y0, x1, y1, color, under, nib} = segment;

        let p0 = this.invertPoint(x0, y0);
        let p1 = this.invertPoint(x1, y1);

        let ctx = this.dom.getContext("2d");

        let rule = "source-over";
        let c = color || "black";
        if (color === "#00000000") {
            rule = "destination-out";
            c = "green";
        }
        if (under) {
            rule = "destinationover";
        }
        ctx.globalCompositeOperation = rule;
        ctx.lineWidth = nib || 8;
        ctx.lineCap = "round";
        ctx.strokeStyle = c;
        ctx.beginPath();
        ctx.moveTo(p0.x, p0.y);
        ctx.lineTo(p1.x, p1.y);
        ctx.stroke();
    }

    pointerDown(evt) {
        if (evt.buttons !== 1) {return;}
        if (this.disabled) {return;}
        if (!evt.isPrimary) {return;}

        evt = this.cookEvent(evt);

        this.addEventListener("pointermove", "pointerMove");
        this.addEventListener("pointerup", "pointerUp");
        this.addEventListener("pointercancel", "pointerUp");
        this.addEventListener("pointerleave", "pointerUp");
        this.addEventListener("lostpointercapture", "pointerLost");

        this.setPointerCapture(evt.pointerId);

        let offsetX = evt.offsetX;
        let offsetY = evt.offsetY;
        let p = this.transformPoint(offsetX, offsetY);
        this.lastPoint = p;
        this.isNew = true;
        this.drawingKey = this.model._get("key");
        this.publish(this.model.id, "startLine", this.drawingKey);
    }

    pointerMove(evt) {
        if (evt.buttons !== 1) {return;}
        if (this.disabled) {return;}
        if (!evt.isPrimary) {return;}

        evt = this.cookEvent(evt);

        if (this.lastPoint) {
            let x0 = this.lastPoint.x;
            let y0 = this.lastPoint.y;

            let p = this.transformPoint(evt.offsetX, evt.offsetY);

            let color = this.color;
            let nibScale = this.parentNode ? this.parentNode.scale : 1;
            if (!nibScale) {
                nibScale = 1;
            }
            let nib = this.nib / nibScale;
            this.lastPoint = p;
            let isNew = this.isNew;
            this.isNew = false;
            this.publish(this.model.id, "addLine", {viewId: this.viewId, x0, y0, x1: p.x, y1: p.y, color, nib, isNew, key: this.drawingKey});
        }
    }

    pointerUp(evt) {
        if (!this.lastPoint) {return;}
        if (this.disabled) {return;}
        if (!evt.isPrimary) {return;}
        let p = this.transformPoint(evt.offsetX, evt.offsetY);
        let last = this.lastPoint;
        if (last && last.x === p.x && last.y === p.y) {
            this.pointerMove({buttons: evt.buttons,
                              offsetX: evt.offsetX + 0.01,
                              offsetY: evt.offsetY});
            this.publish(this.sessionId, "triggerPersist");
        }
        this.lastPoint = null;

        this.removeEventListener("pointerup", "pointerUp");
        this.removeEventListener("pointermove", "pointerMove");
        this.removeEventListener("pointercancel", "pointerUp");
        this.removeEventListener("pointerleave", "pointerUp");
        this.removeEventListener("lostpointercapture", "pointerLost");
    }

    pointerLost(evt) {
        this.releaseAllPointerCapture();
        this.pointerUp(evt);
    }

    transformPoint(x, y) {
        return {x, y};
    }

    invertPoint(x, y) {
        return {x, y};
    }

    enable(flag) {
        this.disabled = !flag;
        this.publish(this.model.id, "enable", flag);
    }
}

function drawingStart(parent, _json, persistentData) {
    let draw = parent.createElement();
    draw.domId = "draw";
    draw.setCode("drawing.DrawingModel");

    draw.setStyleClasses(`
.buttonRow {
    position: fixed;
    top: 8px;
    display: flex;
    width: 100%;
    height: 40px;
    z-index: 2;
    pointer-events: none;
}

#pickerContainer {
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    border-radius: 20px;
    margin-left: 8px;
    background-color: #f4f9ff;
    pointer-events: auto;
    cursor: pointer;
}

#menuContainer {
    position: fixed;
    display: flex;
    flex-direction: column;
    align-items: center;
    border-radius: 20px;
    background-color: #f4f9ff;
    right: 6px;
    top: 48px;
    width: 40px;
    padding-top: 10px;
    padding-bottom: 10px;
    transition: top 0.25s;
    pointer-events: auto;
}

#menuContainer.menu-hidden {
    top: -300px;
}


#menuHolder {
    display: flex;
    align-items: center;
    border-radius: 20px;
    background-color: #f4f9ff;
    height: 38px;
    margin-left: auto;
    margin-right: 8px;
    pointer-events: auto;
    z-index: 2;
}

.colorPicker {
    position: fixed;
    left: 8px;
    top: 50px;
    width: 100px;
    height: 135px;
    z-index: 2;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    transition: height 0.25s, margin 0.25s;
    pointer-events: auto;
}

.color-palette {
    display: flex;
    flex-wrap: wrap;
    border-radius: 8px;
    align-items: center;
    justify-content: center;
    background-color: #f4f9ff;
    transition: height 0.25s;
    pointer-events: auto;
}

.nibs-palette {
    display: flex;
    border-radius: 20px;
    margin-top: 8px;
    height: 32px;
    background-color: #f4f9ff;
    justify-content: center;
    align-items: center;
    transition: height 0.25s;
}

.colorPicker.picker-hidden {
    height: 0px;
}

.picker-hidden>.color-palette {
    height: 0px;
}

.picker-hidden>.nibs-palette {
    height: 0px;
}

.swatch {
    width: 20px;
    height: 20px;
    margin: 4px;
    border: 1px solid #666666;
    border-radius: 50%;
    cursor: pointer;
}

.swatch[color="#00000000"] {
    background-color: white;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100%25' height='100%25'%3E%3Cstyle type='text/css'%3E %23checkerboard %7B fill: %23ccc; %7D %3C/style%3E%3Cdefs%3E%3Cpattern id='checkerboard' patternUnits='userSpaceOnUse' width='10' height='10'%3E%3Crect x='0' y='0' width='5' height='5' /%3E%3Crect x='5' y='5' width='5' height='5' /%3E%3C/pattern%3E%3C/defs%3E%3Crect width='100%25' height='100%25' fill='url(%23checkerboard)' /%3E%3C/svg%3E");
}

.picker-hidden .color-palette {
    height: 0px;
    overflow: hidden;
}

.swatch-pen {
    border-radius: 50%;
    border: 1px solid gray;

}

.swatch-pen[color="#00000000"] {
    background-color: white;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100%25' height='100%25'%3E%3Cstyle type='text/css'%3E %23checkerboard %7B fill: %23ccc; %7D %3C/style%3E%3Cdefs%3E%3Cpattern id='checkerboard' patternUnits='userSpaceOnUse' width='10' height='10'%3E%3Crect x='0' y='0' width='5' height='5' /%3E%3Crect x='5' y='5' width='5' height='5' /%3E%3C/pattern%3E%3C/defs%3E%3Crect width='100%25' height='100%25' fill='url(%23checkerboard)' /%3E%3C/svg%3E");
}

.nib-holder {
    border: 0px;
    display: flex;
    align-items: center;
    margin-left: 6px;
    margin-right: 6px;
    justify-content: center;
}

.picker-hidden .nib-holder {
    height: 0px;
    overflow: hidden;
}

.selected {
    border: 1px solid white;
}

.button-list {
    display: flex;
    margin-bottom: 8px;
    align-items: center;
    background-color: white;
}

.no-picture {
    border: 1px solid #D0D0D0;
}

.doButton {
    display: flex;
    justify-content: center;
    align-items: center;
    width: 28px;
    height: 28px;
    border-radius: 50%;
    margin-left: 4px;
    margin-right: 4px;
}

.doButton:hover {
    background-color: white;
}

.buttonRowIcon {
    width: 36px;
    height: 36px;
    background-position: center;
    background-size: contain;
    transform: scale(1.2);
    cursor: pointer;
}

.pickerIcon {
    width: 20px;
    height: 20px;
    border-radius: 50%;
}

.fullScreenIcon {
    background-image: url("data:image/svg+xml,%3C%3Fxml version='1.0' encoding='utf-8'%3F%3E%3C!-- Generator: Adobe Illustrator 24.3.0, SVG Export Plug-In . SVG Version: 6.00 Build 0) --%3E%3Csvg version='1.1' id='Layer_1' xmlns='http://www.w3.org/2000/svg' xmlns:xlink='http://www.w3.org/1999/xlink' x='0px' y='0px' viewBox='0 0 24 24' style='enable-background:new 0 0 24 24;' xml:space='preserve'%3E%3Cstyle type='text/css'%3E .st0%7Bfill:%23F4F9FF;%7D .st1%7Bfill:%23EF4B3E;%7D .st2%7Bfill:%23754C24;stroke:%23FFFFFF;stroke-width:0.75;stroke-miterlimit:10;%7D .st3%7Bstroke:%23000000;stroke-width:2.856;stroke-miterlimit:10;%7D .st4%7Bfill:none;stroke:%23FFFFFF;stroke-width:2;stroke-miterlimit:10;%7D .st5%7Bfill:%23FFFFFF;%7D .st6%7Bfill:%23F9F9F9;%7D .st7%7Bfill:none;stroke:%23FFFFFF;stroke-width:2.0229;stroke-miterlimit:10;%7D .st8%7Bfill:%23FFFFFF;stroke:%23FFFFFF;stroke-width:0.5;stroke-miterlimit:10;%7D .st9%7Bfill:none;stroke:%23000000;stroke-width:7.6112;stroke-miterlimit:10;%7D .st10%7Bstroke:%23FFFFFF;stroke-miterlimit:10;%7D .st11%7Bfill:none;stroke:%23000000;stroke-width:6.6078;stroke-miterlimit:10;%7D .st12%7Bstroke:%23000000;stroke-width:1.7107;stroke-miterlimit:10;%7D .st13%7Bfill:%23FFFFFF;stroke:%23EF4B3E;stroke-width:0.5304;stroke-miterlimit:10;%7D .st14%7Bfill:%23FFFFFF;stroke:%23FFFFFF;stroke-width:0.406;stroke-miterlimit:10;%7D .st15%7Bfill:none;stroke:%23FFFFFF;stroke-width:1.0951;stroke-miterlimit:10;%7D .st16%7Bfill:%23FFFFFF;stroke:%23FFFFFF;stroke-width:0.2707;stroke-miterlimit:10;%7D .st17%7Bfill:%23FFFFFF;stroke:%23FFFFFF;stroke-width:0.3006;stroke-miterlimit:10;%7D .st18%7Bstroke:%23000000;stroke-width:0.25;stroke-miterlimit:10;%7D .st19%7Bfill:%23EF4B3E;stroke:%23EF4B3E;stroke-width:0.5;stroke-miterlimit:10;%7D .st20%7Bfill:%23EF4B3E;stroke:%23EF4B3E;stroke-width:0.5497;stroke-miterlimit:10;%7D .st21%7Bfill:%23FFFFFF;stroke:%23FFFFFF;stroke-width:0.5497;stroke-miterlimit:10;%7D .st22%7Bfill:%23898989;%7D .st23%7Bfill:%23212529;%7D .st24%7Bfill:%23898989;stroke:%23898989;stroke-width:0.25;stroke-miterlimit:10;%7D .st25%7Bfill:%23898989;stroke:%23212529;stroke-width:0.25;stroke-miterlimit:10;%7D .st26%7Bfill:%23898989;stroke:%23212529;stroke-width:0.1275;stroke-miterlimit:10;%7D .st27%7Bfill:%23898989;stroke:%23212529;stroke-width:0.0697;stroke-miterlimit:10;%7D .st28%7Bfill:%23FF0000;%7D .st29%7Bfill:%23FFFF00;%7D .st30%7Bfill:%2300FF00;%7D .st31%7Bfill:%2300FFFF;%7D .st32%7Bfill:%230000FF;%7D .st33%7Bfill:%23FF00FF;%7D .st34%7Bfill:%23C1272D;%7D .st35%7Bfill:%23F15A24;%7D .st36%7Bfill:%23F7931E;%7D .st37%7Bfill:%23FCEE21;%7D .st38%7Bfill:%238CC63F;%7D .st39%7Bfill:%23006837;%7D .st40%7Bfill:%23ED1E79;%7D .st41%7Bfill:%23603813;%7D .st42%7Bfill:%23FFFFFF;stroke:%23000000;stroke-width:0.4185;stroke-miterlimit:10;%7D .st43%7Bfill:%23454966;stroke:%23454966;stroke-width:0.3101;stroke-miterlimit:10;%7D .st44%7Bfill:%23454966;stroke:%23454966;stroke-miterlimit:10;%7D .st45%7Bfill:%23454966;stroke:%23454966;stroke-width:0.75;stroke-miterlimit:10;%7D .st46%7Bfill:%23454966;%7D .st47%7Bfill:%23454966;stroke:%23454966;stroke-width:0.3041;stroke-miterlimit:10;%7D .st48%7Bfill:%23202020;%7D .st49%7Bfill:%23FFFFFF;stroke:%23454966;stroke-width:0.5;stroke-miterlimit:10;%7D .st50%7Bfill:%23DDDDDD;%7D .st51%7Bfill:%23FE5245;%7D .st52%7Bfill:%23FE9C39;%7D .st53%7Bfill:%23FFE831;%7D .st54%7Bfill:%237ADFFE;%7D .st55%7Bfill:%2332AE49;%7D .st56%7Bfill:none;%7D .st57%7Bfill:%23454966;stroke:%23454966;stroke-width:0.5;stroke-miterlimit:10;%7D .st58%7Bfill:%23454966;stroke:%23454966;stroke-width:0.5267;stroke-miterlimit:10;%7D .st59%7Bfill:%23454966;stroke:%23454966;stroke-width:0.1953;stroke-miterlimit:10;%7D .st60%7Bfill:%23454966;stroke:%23454966;stroke-width:0.4787;stroke-miterlimit:10;%7D .st61%7Bfill:%23454966;stroke:%23454966;stroke-width:0.0519;stroke-miterlimit:10;%7D .st62%7Bopacity:0.43;%7D .st63%7Bfill:%23454966;stroke:%23454966;stroke-width:0.1042;stroke-miterlimit:10;%7D .st64%7Bfill:%23454966;stroke:%23454966;stroke-width:0.1317;stroke-miterlimit:10;%7D .st65%7Bfill:%23454966;stroke:%23454966;stroke-width:0.1847;stroke-miterlimit:10;%7D .st66%7Bfill:%23454966;stroke:%23454966;stroke-width:0.0673;stroke-miterlimit:10;%7D%0A%3C/style%3E%3Cg%3E%3Cg%3E%3Cpath class='st43' d='M7.03,9.21c0,0.79,0,1.52,0,2.26c0,0.4-0.09,0.49-0.49,0.49c-0.02,0-0.04,0-0.06,0 c-0.61,0-0.64-0.03-0.64-0.63c0-0.86,0-1.71,0-2.57c0-0.51,0.23-0.74,0.75-0.74c0.9,0,1.79,0,2.69,0c0.41,0,0.5,0.1,0.51,0.51 c0,0.09,0,0.18,0,0.27C9.77,9.1,9.66,9.21,9.36,9.21c-0.66,0-1.31,0-1.97,0C7.28,9.21,7.17,9.21,7.03,9.21z'/%3E%3Cpath class='st43' d='M7.03,16.25c0.74,0,1.46-0.01,2.17,0.01c0.18,0,0.49,0.08,0.51,0.17c0.06,0.28,0.03,0.58-0.01,0.87 c-0.01,0.06-0.21,0.14-0.33,0.14c-0.96,0.01-1.93,0.01-2.89,0c-0.4,0-0.64-0.27-0.64-0.67c-0.01-0.94,0-1.89,0-2.83 c0-0.34,0.09-0.42,0.43-0.42c0.76-0.02,0.77-0.01,0.77,0.75C7.03,14.92,7.03,15.57,7.03,16.25z'/%3E%3Cpath class='st43' d='M17.2,9.21c-0.79,0-1.52,0-2.26,0c-0.4,0-0.47-0.07-0.48-0.47c-0.01-0.71,0-0.73,0.73-0.73 c0.8,0,1.59,0,2.39,0c0.6,0,0.81,0.21,0.82,0.8c0,0.88,0,1.77,0,2.65c0,0.41-0.08,0.49-0.49,0.49c-0.68,0.01-0.71-0.02-0.71-0.69 C17.2,10.6,17.2,9.92,17.2,9.21z'/%3E%3Cpath class='st43' d='M17.2,16.25c0-0.77,0-1.5,0-2.22c0-0.45,0.07-0.52,0.52-0.52c0.66,0,0.67,0.01,0.67,0.66 c0,0.85,0,1.69,0,2.54c0,0.5-0.23,0.74-0.73,0.74c-0.92,0-1.83,0-2.75,0c-0.36,0-0.44-0.09-0.45-0.44c-0.02-0.74,0-0.76,0.73-0.76 C15.85,16.25,16.5,16.25,17.2,16.25z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E%0A");
}

.deleteIcon {
    background-image: url("data:image/svg+xml,%3C%3Fxml version='1.0' encoding='utf-8'%3F%3E%3C!-- Generator: Adobe Illustrator 24.3.0, SVG Export Plug-In . SVG Version: 6.00 Build 0) --%3E%3Csvg version='1.1' id='Layer_1' xmlns='http://www.w3.org/2000/svg' xmlns:xlink='http://www.w3.org/1999/xlink' x='0px' y='0px' viewBox='0 0 24 24' style='enable-background:new 0 0 24 24;' xml:space='preserve'%3E%3Cstyle type='text/css'%3E .st0%7Bfill:%23F4F9FF;%7D .st1%7Bfill:%23EF4B3E;%7D .st2%7Bfill:%23754C24;stroke:%23FFFFFF;stroke-width:0.75;stroke-miterlimit:10;%7D .st3%7Bstroke:%23000000;stroke-width:2.856;stroke-miterlimit:10;%7D .st4%7Bfill:none;stroke:%23FFFFFF;stroke-width:2;stroke-miterlimit:10;%7D .st5%7Bfill:%23FFFFFF;%7D .st6%7Bfill:%23F9F9F9;%7D .st7%7Bfill:none;stroke:%23FFFFFF;stroke-width:2.0229;stroke-miterlimit:10;%7D .st8%7Bfill:%23FFFFFF;stroke:%23FFFFFF;stroke-width:0.5;stroke-miterlimit:10;%7D .st9%7Bfill:none;stroke:%23000000;stroke-width:7.6112;stroke-miterlimit:10;%7D .st10%7Bstroke:%23FFFFFF;stroke-miterlimit:10;%7D .st11%7Bfill:none;stroke:%23000000;stroke-width:6.6078;stroke-miterlimit:10;%7D .st12%7Bstroke:%23000000;stroke-width:1.7107;stroke-miterlimit:10;%7D .st13%7Bfill:%23FFFFFF;stroke:%23EF4B3E;stroke-width:0.5304;stroke-miterlimit:10;%7D .st14%7Bfill:%23FFFFFF;stroke:%23FFFFFF;stroke-width:0.406;stroke-miterlimit:10;%7D .st15%7Bfill:none;stroke:%23FFFFFF;stroke-width:1.0951;stroke-miterlimit:10;%7D .st16%7Bfill:%23FFFFFF;stroke:%23FFFFFF;stroke-width:0.2707;stroke-miterlimit:10;%7D .st17%7Bfill:%23FFFFFF;stroke:%23FFFFFF;stroke-width:0.3006;stroke-miterlimit:10;%7D .st18%7Bstroke:%23000000;stroke-width:0.25;stroke-miterlimit:10;%7D .st19%7Bfill:%23EF4B3E;stroke:%23EF4B3E;stroke-width:0.5;stroke-miterlimit:10;%7D .st20%7Bfill:%23EF4B3E;stroke:%23EF4B3E;stroke-width:0.5497;stroke-miterlimit:10;%7D .st21%7Bfill:%23FFFFFF;stroke:%23FFFFFF;stroke-width:0.5497;stroke-miterlimit:10;%7D .st22%7Bfill:%23898989;%7D .st23%7Bfill:%23212529;%7D .st24%7Bfill:%23898989;stroke:%23898989;stroke-width:0.25;stroke-miterlimit:10;%7D .st25%7Bfill:%23898989;stroke:%23212529;stroke-width:0.25;stroke-miterlimit:10;%7D .st26%7Bfill:%23898989;stroke:%23212529;stroke-width:0.1275;stroke-miterlimit:10;%7D .st27%7Bfill:%23898989;stroke:%23212529;stroke-width:0.0697;stroke-miterlimit:10;%7D .st28%7Bfill:%23FF0000;%7D .st29%7Bfill:%23FFFF00;%7D .st30%7Bfill:%2300FF00;%7D .st31%7Bfill:%2300FFFF;%7D .st32%7Bfill:%230000FF;%7D .st33%7Bfill:%23FF00FF;%7D .st34%7Bfill:%23C1272D;%7D .st35%7Bfill:%23F15A24;%7D .st36%7Bfill:%23F7931E;%7D .st37%7Bfill:%23FCEE21;%7D .st38%7Bfill:%238CC63F;%7D .st39%7Bfill:%23006837;%7D .st40%7Bfill:%23ED1E79;%7D .st41%7Bfill:%23603813;%7D .st42%7Bfill:%23FFFFFF;stroke:%23000000;stroke-width:0.4185;stroke-miterlimit:10;%7D .st43%7Bfill:%23454966;stroke:%23454966;stroke-width:0.3101;stroke-miterlimit:10;%7D .st44%7Bfill:%23454966;stroke:%23454966;stroke-miterlimit:10;%7D .st45%7Bfill:%23454966;stroke:%23454966;stroke-width:0.75;stroke-miterlimit:10;%7D .st46%7Bfill:%23454966;%7D .st47%7Bfill:%23454966;stroke:%23454966;stroke-width:0.3041;stroke-miterlimit:10;%7D .st48%7Bfill:%23202020;%7D .st49%7Bfill:%23FFFFFF;stroke:%23454966;stroke-width:0.5;stroke-miterlimit:10;%7D .st50%7Bfill:%23DDDDDD;%7D .st51%7Bfill:%23FE5245;%7D .st52%7Bfill:%23FE9C39;%7D .st53%7Bfill:%23FFE831;%7D .st54%7Bfill:%237ADFFE;%7D .st55%7Bfill:%2332AE49;%7D .st56%7Bfill:none;%7D .st57%7Bfill:%23454966;stroke:%23454966;stroke-width:0.5;stroke-miterlimit:10;%7D .st58%7Bfill:%23454966;stroke:%23454966;stroke-width:0.5267;stroke-miterlimit:10;%7D .st59%7Bfill:%23454966;stroke:%23454966;stroke-width:0.1953;stroke-miterlimit:10;%7D .st60%7Bfill:%23454966;stroke:%23454966;stroke-width:0.4787;stroke-miterlimit:10;%7D .st61%7Bfill:%23454966;stroke:%23454966;stroke-width:0.0519;stroke-miterlimit:10;%7D .st62%7Bopacity:0.43;%7D .st63%7Bfill:%23454966;stroke:%23454966;stroke-width:0.1042;stroke-miterlimit:10;%7D .st64%7Bfill:%23454966;stroke:%23454966;stroke-width:0.1317;stroke-miterlimit:10;%7D .st65%7Bfill:%23454966;stroke:%23454966;stroke-width:0.1847;stroke-miterlimit:10;%7D .st66%7Bfill:%23454966;stroke:%23454966;stroke-width:0.0673;stroke-miterlimit:10;%7D%0A%3C/style%3E%3Cg%3E%3Cg%3E%3Cpath class='st58' d='M15.38,9.53c-0.09,1-0.18,1.97-0.27,2.95c-0.11,1.25-0.23,2.51-0.35,3.76c-0.04,0.43-0.4,0.76-0.83,0.76 c-1.41,0.01-2.83,0.01-4.24,0c-0.44,0-0.8-0.33-0.84-0.77c-0.15-1.57-0.29-3.15-0.43-4.72c-0.06-0.65-0.12-1.31-0.18-1.97 c-0.06-0.01-0.1-0.01-0.14-0.02C7.79,9.51,7.68,9.37,7.78,9.06C7.8,9,7.93,8.93,8.01,8.93c0.48-0.01,0.97-0.02,1.45,0 C9.71,8.94,9.87,8.86,10,8.66c0.13-0.2,0.29-0.39,0.44-0.58c0.17-0.21,0.39-0.3,0.65-0.3c0.48,0,0.97,0,1.45,0 c0.25,0,0.47,0.1,0.64,0.29c0.16,0.19,0.32,0.38,0.45,0.59c0.13,0.2,0.28,0.28,0.52,0.27c0.47-0.02,0.94-0.01,1.41-0.01 c0.27,0,0.3,0.03,0.3,0.28c0,0.28-0.02,0.31-0.29,0.32C15.52,9.52,15.46,9.53,15.38,9.53z M14.78,9.54c-1.99,0-3.96,0-5.93,0 c0,0.05,0,0.09,0.01,0.13c0.09,1.09,0.19,2.19,0.28,3.28c0.09,1.02,0.18,2.04,0.28,3.06c0.04,0.37,0.11,0.42,0.47,0.42 c1.22,0,2.45,0,3.67,0c0.6,0,0.62-0.03,0.67-0.64c0.1-1.25,0.22-2.49,0.33-3.74C14.64,11.22,14.71,10.39,14.78,9.54z M13.09,8.91 c-0.07-0.1-0.12-0.16-0.16-0.23c-0.14-0.25-0.34-0.35-0.63-0.33c-0.3,0.02-0.61,0.01-0.92,0.01c-0.45,0-0.62,0.11-0.8,0.55 C11.4,8.91,12.22,8.91,13.09,8.91z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E%0A");
}

.newBlankIcon {
    background-image: url("data:image/svg+xml,%3C%3Fxml version='1.0' encoding='utf-8'%3F%3E%3C!-- Generator: Adobe Illustrator 24.3.0, SVG Export Plug-In . SVG Version: 6.00 Build 0) --%3E%3Csvg version='1.1' id='Layer_1' xmlns='http://www.w3.org/2000/svg' xmlns:xlink='http://www.w3.org/1999/xlink' x='0px' y='0px' viewBox='0 0 24 24' style='enable-background:new 0 0 24 24;' xml:space='preserve'%3E%3Cstyle type='text/css'%3E .st0%7Bfill:%23F4F9FF;%7D .st1%7Bfill:%23EF4B3E;%7D .st2%7Bfill:%23754C24;stroke:%23FFFFFF;stroke-width:0.75;stroke-miterlimit:10;%7D .st3%7Bstroke:%23000000;stroke-width:2.856;stroke-miterlimit:10;%7D .st4%7Bfill:none;stroke:%23FFFFFF;stroke-width:2;stroke-miterlimit:10;%7D .st5%7Bfill:%23FFFFFF;%7D .st6%7Bfill:%23F9F9F9;%7D .st7%7Bfill:none;stroke:%23FFFFFF;stroke-width:2.0229;stroke-miterlimit:10;%7D .st8%7Bfill:%23FFFFFF;stroke:%23FFFFFF;stroke-width:0.5;stroke-miterlimit:10;%7D .st9%7Bfill:none;stroke:%23000000;stroke-width:7.6112;stroke-miterlimit:10;%7D .st10%7Bstroke:%23FFFFFF;stroke-miterlimit:10;%7D .st11%7Bfill:none;stroke:%23000000;stroke-width:6.6078;stroke-miterlimit:10;%7D .st12%7Bstroke:%23000000;stroke-width:1.7107;stroke-miterlimit:10;%7D .st13%7Bfill:%23FFFFFF;stroke:%23EF4B3E;stroke-width:0.5304;stroke-miterlimit:10;%7D .st14%7Bfill:%23FFFFFF;stroke:%23FFFFFF;stroke-width:0.406;stroke-miterlimit:10;%7D .st15%7Bfill:none;stroke:%23FFFFFF;stroke-width:1.0951;stroke-miterlimit:10;%7D .st16%7Bfill:%23FFFFFF;stroke:%23FFFFFF;stroke-width:0.2707;stroke-miterlimit:10;%7D .st17%7Bfill:%23FFFFFF;stroke:%23FFFFFF;stroke-width:0.3006;stroke-miterlimit:10;%7D .st18%7Bstroke:%23000000;stroke-width:0.25;stroke-miterlimit:10;%7D .st19%7Bfill:%23EF4B3E;stroke:%23EF4B3E;stroke-width:0.5;stroke-miterlimit:10;%7D .st20%7Bfill:%23EF4B3E;stroke:%23EF4B3E;stroke-width:0.5497;stroke-miterlimit:10;%7D .st21%7Bfill:%23FFFFFF;stroke:%23FFFFFF;stroke-width:0.5497;stroke-miterlimit:10;%7D .st22%7Bfill:%23898989;%7D .st23%7Bfill:%23212529;%7D .st24%7Bfill:%23898989;stroke:%23898989;stroke-width:0.25;stroke-miterlimit:10;%7D .st25%7Bfill:%23898989;stroke:%23212529;stroke-width:0.25;stroke-miterlimit:10;%7D .st26%7Bfill:%23898989;stroke:%23212529;stroke-width:0.1275;stroke-miterlimit:10;%7D .st27%7Bfill:%23898989;stroke:%23212529;stroke-width:0.0697;stroke-miterlimit:10;%7D .st28%7Bfill:%23FF0000;%7D .st29%7Bfill:%23FFFF00;%7D .st30%7Bfill:%2300FF00;%7D .st31%7Bfill:%2300FFFF;%7D .st32%7Bfill:%230000FF;%7D .st33%7Bfill:%23FF00FF;%7D .st34%7Bfill:%23C1272D;%7D .st35%7Bfill:%23F15A24;%7D .st36%7Bfill:%23F7931E;%7D .st37%7Bfill:%23FCEE21;%7D .st38%7Bfill:%238CC63F;%7D .st39%7Bfill:%23006837;%7D .st40%7Bfill:%23ED1E79;%7D .st41%7Bfill:%23603813;%7D .st42%7Bfill:%23FFFFFF;stroke:%23000000;stroke-width:0.4185;stroke-miterlimit:10;%7D .st43%7Bfill:%23454966;stroke:%23454966;stroke-width:0.3101;stroke-miterlimit:10;%7D .st44%7Bfill:%23454966;stroke:%23454966;stroke-miterlimit:10;%7D .st45%7Bfill:%23454966;stroke:%23454966;stroke-width:0.75;stroke-miterlimit:10;%7D .st46%7Bfill:%23454966;%7D .st47%7Bfill:%23454966;stroke:%23454966;stroke-width:0.3041;stroke-miterlimit:10;%7D .st48%7Bfill:%23202020;%7D .st49%7Bfill:%23FFFFFF;stroke:%23454966;stroke-width:0.5;stroke-miterlimit:10;%7D .st50%7Bfill:%23DDDDDD;%7D .st51%7Bfill:%23FE5245;%7D .st52%7Bfill:%23FE9C39;%7D .st53%7Bfill:%23FFE831;%7D .st54%7Bfill:%237ADFFE;%7D .st55%7Bfill:%2332AE49;%7D .st56%7Bfill:none;%7D .st57%7Bfill:%23454966;stroke:%23454966;stroke-width:0.5;stroke-miterlimit:10;%7D .st58%7Bfill:%23454966;stroke:%23454966;stroke-width:0.5267;stroke-miterlimit:10;%7D .st59%7Bfill:%23454966;stroke:%23454966;stroke-width:0.1953;stroke-miterlimit:10;%7D .st60%7Bfill:%23454966;stroke:%23454966;stroke-width:0.4787;stroke-miterlimit:10;%7D .st61%7Bfill:%23454966;stroke:%23454966;stroke-width:0.0519;stroke-miterlimit:10;%7D .st62%7Bopacity:0.43;%7D .st63%7Bfill:%23454966;stroke:%23454966;stroke-width:0.1042;stroke-miterlimit:10;%7D .st64%7Bfill:%23454966;stroke:%23454966;stroke-width:0.1317;stroke-miterlimit:10;%7D .st65%7Bfill:%23454966;stroke:%23454966;stroke-width:0.1847;stroke-miterlimit:10;%7D .st66%7Bfill:%23454966;stroke:%23454966;stroke-width:0.0673;stroke-miterlimit:10;%7D%0A%3C/style%3E%3Cg%3E%3Cg%3E%3Cg%3E%3Cpath class='st61' d='M8.5,12.39c0-1.26,0.02-2.53-0.01-3.79c-0.01-0.67,0.44-1.1,1.12-1.08c1.25,0.03,2.49,0.01,3.74,0.01 c0.34,0,0.61,0.11,0.85,0.34c0.49,0.48,0.98,0.96,1.48,1.44c0.25,0.24,0.36,0.51,0.36,0.84c0,2.03,0,4.05,0,6.08 c0,0.66-0.37,1.02-1.04,1.02c-1.82,0-3.63,0-5.45,0c-0.67,0-1.04-0.36-1.04-1.02C8.5,14.95,8.5,13.67,8.5,12.39z M9.47,16.31 c1.88,0,3.74,0,5.6,0c0-1.82,0-3.61,0-5.43c-0.64,0-1.26,0-1.87,0c-0.45,0-0.61-0.16-0.62-0.6c0-0.35,0-0.71,0-1.06 c0-0.24,0-0.49,0-0.74c-1.05,0-2.07,0-3.1,0C9.47,11.09,9.47,13.69,9.47,16.31z M14.83,9.95c-0.41-0.42-0.85-0.88-1.29-1.33 c0,0.44,0,0.88,0,1.33C14.02,9.95,14.47,9.95,14.83,9.95z'/%3E%3C/g%3E%3C/g%3E%3Cg%3E%3Cellipse class='st60' cx='15.64' cy='13.2' rx='2.87' ry='2.79'/%3E%3Cg%3E%3Cg%3E%3Cpath class='st0' d='M15.39,12.95v-0.73c0-0.06,0.02-0.12,0.07-0.17c0.05-0.05,0.11-0.07,0.18-0.07c0.07,0,0.12,0.02,0.17,0.07 c0.05,0.05,0.07,0.1,0.07,0.17v0.73h0.76c0.07,0,0.13,0.02,0.18,0.07c0.05,0.05,0.07,0.1,0.07,0.17s-0.02,0.12-0.07,0.17 c-0.05,0.05-0.11,0.07-0.18,0.07h-0.75v0.73c0,0.07-0.02,0.13-0.07,0.17c-0.05,0.05-0.11,0.07-0.18,0.07 c-0.07,0-0.13-0.02-0.17-0.07c-0.05-0.05-0.07-0.11-0.07-0.17v-0.73h-0.76c-0.07,0-0.12-0.02-0.17-0.07 c-0.05-0.05-0.07-0.1-0.07-0.17c0-0.06,0.02-0.12,0.07-0.17c0.05-0.05,0.11-0.07,0.17-0.07H15.39z'/%3E%3C/g%3E%3C/g%3E%3C/g%3E%3C/g%3E%3C/svg%3E%0A");
}

.addPictureIcon {
    background-image: url("data:image/svg+xml,%3C%3Fxml version='1.0' encoding='utf-8'%3F%3E%3C!-- Generator: Adobe Illustrator 24.3.0, SVG Export Plug-In . SVG Version: 6.00 Build 0) --%3E%3Csvg version='1.1' id='Layer_1' xmlns='http://www.w3.org/2000/svg' xmlns:xlink='http://www.w3.org/1999/xlink' x='0px' y='0px' viewBox='0 0 24 24' style='enable-background:new 0 0 24 24;' xml:space='preserve'%3E%3Cstyle type='text/css'%3E .st0%7Bfill:%23F4F9FF;%7D .st1%7Bfill:%23EF4B3E;%7D .st2%7Bfill:%23754C24;stroke:%23FFFFFF;stroke-width:0.75;stroke-miterlimit:10;%7D .st3%7Bstroke:%23000000;stroke-width:2.856;stroke-miterlimit:10;%7D .st4%7Bfill:none;stroke:%23FFFFFF;stroke-width:2;stroke-miterlimit:10;%7D .st5%7Bfill:%23FFFFFF;%7D .st6%7Bfill:%23F9F9F9;%7D .st7%7Bfill:none;stroke:%23FFFFFF;stroke-width:2.0229;stroke-miterlimit:10;%7D .st8%7Bfill:%23FFFFFF;stroke:%23FFFFFF;stroke-width:0.5;stroke-miterlimit:10;%7D .st9%7Bfill:none;stroke:%23000000;stroke-width:7.6112;stroke-miterlimit:10;%7D .st10%7Bstroke:%23FFFFFF;stroke-miterlimit:10;%7D .st11%7Bfill:none;stroke:%23000000;stroke-width:6.6078;stroke-miterlimit:10;%7D .st12%7Bstroke:%23000000;stroke-width:1.7107;stroke-miterlimit:10;%7D .st13%7Bfill:%23FFFFFF;stroke:%23EF4B3E;stroke-width:0.5304;stroke-miterlimit:10;%7D .st14%7Bfill:%23FFFFFF;stroke:%23FFFFFF;stroke-width:0.406;stroke-miterlimit:10;%7D .st15%7Bfill:none;stroke:%23FFFFFF;stroke-width:1.0951;stroke-miterlimit:10;%7D .st16%7Bfill:%23FFFFFF;stroke:%23FFFFFF;stroke-width:0.2707;stroke-miterlimit:10;%7D .st17%7Bfill:%23FFFFFF;stroke:%23FFFFFF;stroke-width:0.3006;stroke-miterlimit:10;%7D .st18%7Bstroke:%23000000;stroke-width:0.25;stroke-miterlimit:10;%7D .st19%7Bfill:%23EF4B3E;stroke:%23EF4B3E;stroke-width:0.5;stroke-miterlimit:10;%7D .st20%7Bfill:%23EF4B3E;stroke:%23EF4B3E;stroke-width:0.5497;stroke-miterlimit:10;%7D .st21%7Bfill:%23FFFFFF;stroke:%23FFFFFF;stroke-width:0.5497;stroke-miterlimit:10;%7D .st22%7Bfill:%23898989;%7D .st23%7Bfill:%23212529;%7D .st24%7Bfill:%23898989;stroke:%23898989;stroke-width:0.25;stroke-miterlimit:10;%7D .st25%7Bfill:%23898989;stroke:%23212529;stroke-width:0.25;stroke-miterlimit:10;%7D .st26%7Bfill:%23898989;stroke:%23212529;stroke-width:0.1275;stroke-miterlimit:10;%7D .st27%7Bfill:%23898989;stroke:%23212529;stroke-width:0.0697;stroke-miterlimit:10;%7D .st28%7Bfill:%23FF0000;%7D .st29%7Bfill:%23FFFF00;%7D .st30%7Bfill:%2300FF00;%7D .st31%7Bfill:%2300FFFF;%7D .st32%7Bfill:%230000FF;%7D .st33%7Bfill:%23FF00FF;%7D .st34%7Bfill:%23C1272D;%7D .st35%7Bfill:%23F15A24;%7D .st36%7Bfill:%23F7931E;%7D .st37%7Bfill:%23FCEE21;%7D .st38%7Bfill:%238CC63F;%7D .st39%7Bfill:%23006837;%7D .st40%7Bfill:%23ED1E79;%7D .st41%7Bfill:%23603813;%7D .st42%7Bfill:%23FFFFFF;stroke:%23000000;stroke-width:0.4185;stroke-miterlimit:10;%7D .st43%7Bfill:%23454966;stroke:%23454966;stroke-width:0.3101;stroke-miterlimit:10;%7D .st44%7Bfill:%23454966;stroke:%23454966;stroke-miterlimit:10;%7D .st45%7Bfill:%23454966;stroke:%23454966;stroke-width:0.75;stroke-miterlimit:10;%7D .st46%7Bfill:%23454966;%7D .st47%7Bfill:%23454966;stroke:%23454966;stroke-width:0.3041;stroke-miterlimit:10;%7D .st48%7Bfill:%23202020;%7D .st49%7Bfill:%23FFFFFF;stroke:%23454966;stroke-width:0.5;stroke-miterlimit:10;%7D .st50%7Bfill:%23DDDDDD;%7D .st51%7Bfill:%23FE5245;%7D .st52%7Bfill:%23FE9C39;%7D .st53%7Bfill:%23FFE831;%7D .st54%7Bfill:%237ADFFE;%7D .st55%7Bfill:%2332AE49;%7D .st56%7Bfill:none;%7D .st57%7Bfill:%23454966;stroke:%23454966;stroke-width:0.5;stroke-miterlimit:10;%7D .st58%7Bfill:%23454966;stroke:%23454966;stroke-width:0.5267;stroke-miterlimit:10;%7D .st59%7Bfill:%23454966;stroke:%23454966;stroke-width:0.1953;stroke-miterlimit:10;%7D .st60%7Bfill:%23454966;stroke:%23454966;stroke-width:0.4787;stroke-miterlimit:10;%7D .st61%7Bfill:%23454966;stroke:%23454966;stroke-width:0.0519;stroke-miterlimit:10;%7D .st62%7Bopacity:0.43;%7D .st63%7Bfill:%23454966;stroke:%23454966;stroke-width:0.1042;stroke-miterlimit:10;%7D .st64%7Bfill:%23454966;stroke:%23454966;stroke-width:0.1317;stroke-miterlimit:10;%7D .st65%7Bfill:%23454966;stroke:%23454966;stroke-width:0.1847;stroke-miterlimit:10;%7D .st66%7Bfill:%23454966;stroke:%23454966;stroke-width:0.0673;stroke-miterlimit:10;%7D%0A%3C/style%3E%3Cg%3E%3Cg%3E%3Cpath class='st59' d='M7.46,9.49c0-0.08,0.01-0.15,0.01-0.22c0.01-0.55,0.37-0.91,0.91-0.91c0.88-0.01,1.75,0,2.63,0 c1.56,0,3.11,0,4.67,0c0.67,0,1,0.33,1,0.99c0,1.62,0,3.24,0,4.87c0,0.73-0.3,1.04-1.03,1.07c-0.03,0-0.06,0.01-0.12,0.01 c0,0.08,0,0.17,0,0.25c-0.01,0.49-0.37,0.85-0.86,0.88c-0.06,0-0.12,0-0.18,0c-2.38,0-4.76,0-7.14,0c-0.7,0-1.03-0.33-1.03-1.04 c0-1.6,0.02-3.2-0.01-4.8C6.3,9.88,6.71,9.46,7.34,9.51C7.38,9.51,7.41,9.5,7.46,9.49z M12.07,14.68c1.19,0,2.38,0,3.57,0 c0.38,0,0.46-0.08,0.46-0.46c0-1.6,0-3.2,0-4.8c0-0.39-0.08-0.48-0.47-0.48c-2.37,0-4.74,0-7.1,0c-0.4,0-0.48,0.08-0.48,0.47 c0,1.6,0,3.2,0,4.8c0,0.41,0.06,0.47,0.47,0.47C9.7,14.68,10.88,14.68,12.07,14.68z M7.47,10.11c-0.47-0.05-0.57,0.03-0.57,0.47 c0,1.59,0,3.19,0,4.78c0,0.39,0.08,0.47,0.48,0.47c2.37,0,4.74,0,7.1,0c0.41,0,0.52-0.13,0.44-0.56c-0.08,0-0.17,0-0.25,0 c-2.07,0-4.14,0-6.21,0c-0.64,0-0.99-0.36-1-0.99c0-1.3,0-2.6,0-3.9C7.47,10.3,7.47,10.21,7.47,10.11z'/%3E%3Cpath class='st59' d='M11.49,12.07c0.34-0.34,0.66-0.66,0.98-0.98c0.23-0.23,0.45-0.46,0.68-0.68c0.25-0.25,0.46-0.25,0.7-0.01 c0.5,0.49,1,0.98,1.49,1.49c0.1,0.11,0.17,0.29,0.18,0.45c0.02,0.49,0.01,0.98,0.01,1.47c0,0.24-0.07,0.32-0.31,0.32 c-0.32,0.01-0.64,0-0.96,0c-1.74,0-3.48,0-5.22,0c-0.37,0-0.4-0.05-0.42-0.42c-0.02-0.36,0.1-0.62,0.36-0.87 c0.44-0.4,0.85-0.84,1.28-1.26c0.29-0.28,0.48-0.28,0.77,0.01C11.18,11.74,11.33,11.9,11.49,12.07z M9.24,13.51 c1.89,0,3.79,0,5.68,0c0.08-0.7,0.13-1.37-0.57-1.81c-0.15-0.1-0.27-0.25-0.39-0.38c-0.14-0.15-0.27-0.32-0.44-0.51 c-0.72,0.72-1.38,1.38-2.07,2.08c-0.27-0.29-0.54-0.57-0.77-0.82C10.2,12.56,9.72,13.04,9.24,13.51z'/%3E%3Cpath class='st59' d='M10.49,10.38c0,0.56-0.47,1.01-1.03,1c-0.55-0.01-1-0.47-0.99-1.02c0.01-0.55,0.46-1,1.01-1 C10.04,9.36,10.5,9.82,10.49,10.38z M9.49,9.95c-0.23,0-0.42,0.19-0.43,0.41c-0.01,0.22,0.19,0.43,0.41,0.44 c0.22,0.01,0.44-0.2,0.44-0.43C9.91,10.15,9.72,9.95,9.49,9.95z'/%3E%3C/g%3E%3Cg%3E%3Cellipse class='st60' cx='15.72' cy='12.91' rx='2.87' ry='2.79'/%3E%3Cg%3E%3Cg%3E%3Cpath class='st0' d='M15.47,12.66v-0.73c0-0.06,0.02-0.12,0.07-0.17c0.05-0.05,0.11-0.07,0.18-0.07c0.07,0,0.12,0.02,0.17,0.07 c0.05,0.05,0.07,0.1,0.07,0.17v0.73h0.76c0.07,0,0.13,0.02,0.18,0.07c0.05,0.05,0.07,0.1,0.07,0.17c0,0.07-0.02,0.12-0.07,0.17 c-0.05,0.05-0.11,0.07-0.18,0.07h-0.75v0.73c0,0.07-0.02,0.13-0.07,0.17c-0.05,0.05-0.11,0.07-0.18,0.07 c-0.07,0-0.13-0.02-0.17-0.07s-0.07-0.11-0.07-0.17v-0.73h-0.76c-0.07,0-0.12-0.02-0.17-0.07s-0.07-0.1-0.07-0.17 c0-0.06,0.02-0.12,0.07-0.17c0.05-0.05,0.11-0.07,0.17-0.07H15.47z'/%3E%3C/g%3E%3C/g%3E%3C/g%3E%3C/g%3E%3C/svg%3E%0A");
}

.clearIcon {
    background-image: url("data:image/svg+xml,%3C%3Fxml version='1.0' encoding='utf-8'%3F%3E%3C!-- Generator: Adobe Illustrator 24.3.0, SVG Export Plug-In . SVG Version: 6.00 Build 0) --%3E%3Csvg version='1.1' id='Layer_1' xmlns='http://www.w3.org/2000/svg' xmlns:xlink='http://www.w3.org/1999/xlink' x='0px' y='0px' viewBox='0 0 24 24' style='enable-background:new 0 0 24 24;' xml:space='preserve'%3E%3Cstyle type='text/css'%3E .st0%7Bfill:%23F4F9FF;%7D .st1%7Bfill:%23EF4B3E;%7D .st2%7Bfill:%23754C24;stroke:%23FFFFFF;stroke-width:0.75;stroke-miterlimit:10;%7D .st3%7Bstroke:%23000000;stroke-width:2.856;stroke-miterlimit:10;%7D .st4%7Bfill:none;stroke:%23FFFFFF;stroke-width:2;stroke-miterlimit:10;%7D .st5%7Bfill:%23FFFFFF;%7D .st6%7Bfill:%23F9F9F9;%7D .st7%7Bfill:none;stroke:%23FFFFFF;stroke-width:2.0229;stroke-miterlimit:10;%7D .st8%7Bfill:%23FFFFFF;stroke:%23FFFFFF;stroke-width:0.5;stroke-miterlimit:10;%7D .st9%7Bfill:none;stroke:%23000000;stroke-width:7.6112;stroke-miterlimit:10;%7D .st10%7Bstroke:%23FFFFFF;stroke-miterlimit:10;%7D .st11%7Bfill:none;stroke:%23000000;stroke-width:6.6078;stroke-miterlimit:10;%7D .st12%7Bstroke:%23000000;stroke-width:1.7107;stroke-miterlimit:10;%7D .st13%7Bfill:%23FFFFFF;stroke:%23EF4B3E;stroke-width:0.5304;stroke-miterlimit:10;%7D .st14%7Bfill:%23FFFFFF;stroke:%23FFFFFF;stroke-width:0.406;stroke-miterlimit:10;%7D .st15%7Bfill:none;stroke:%23FFFFFF;stroke-width:1.0951;stroke-miterlimit:10;%7D .st16%7Bfill:%23FFFFFF;stroke:%23FFFFFF;stroke-width:0.2707;stroke-miterlimit:10;%7D .st17%7Bfill:%23FFFFFF;stroke:%23FFFFFF;stroke-width:0.3006;stroke-miterlimit:10;%7D .st18%7Bstroke:%23000000;stroke-width:0.25;stroke-miterlimit:10;%7D .st19%7Bfill:%23EF4B3E;stroke:%23EF4B3E;stroke-width:0.5;stroke-miterlimit:10;%7D .st20%7Bfill:%23EF4B3E;stroke:%23EF4B3E;stroke-width:0.5497;stroke-miterlimit:10;%7D .st21%7Bfill:%23FFFFFF;stroke:%23FFFFFF;stroke-width:0.5497;stroke-miterlimit:10;%7D .st22%7Bfill:%23898989;%7D .st23%7Bfill:%23212529;%7D .st24%7Bfill:%23898989;stroke:%23898989;stroke-width:0.25;stroke-miterlimit:10;%7D .st25%7Bfill:%23898989;stroke:%23212529;stroke-width:0.25;stroke-miterlimit:10;%7D .st26%7Bfill:%23898989;stroke:%23212529;stroke-width:0.1275;stroke-miterlimit:10;%7D .st27%7Bfill:%23898989;stroke:%23212529;stroke-width:0.0697;stroke-miterlimit:10;%7D .st28%7Bfill:%23FF0000;%7D .st29%7Bfill:%23FFFF00;%7D .st30%7Bfill:%2300FF00;%7D .st31%7Bfill:%2300FFFF;%7D .st32%7Bfill:%230000FF;%7D .st33%7Bfill:%23FF00FF;%7D .st34%7Bfill:%23C1272D;%7D .st35%7Bfill:%23F15A24;%7D .st36%7Bfill:%23F7931E;%7D .st37%7Bfill:%23FCEE21;%7D .st38%7Bfill:%238CC63F;%7D .st39%7Bfill:%23006837;%7D .st40%7Bfill:%23ED1E79;%7D .st41%7Bfill:%23603813;%7D .st42%7Bfill:%23FFFFFF;stroke:%23000000;stroke-width:0.4185;stroke-miterlimit:10;%7D .st43%7Bfill:%23454966;stroke:%23454966;stroke-width:0.3101;stroke-miterlimit:10;%7D .st44%7Bfill:%23454966;stroke:%23454966;stroke-miterlimit:10;%7D .st45%7Bfill:%23454966;stroke:%23454966;stroke-width:0.75;stroke-miterlimit:10;%7D .st46%7Bfill:%23454966;%7D .st47%7Bfill:%23454966;stroke:%23454966;stroke-width:0.3041;stroke-miterlimit:10;%7D .st48%7Bfill:%23202020;%7D .st49%7Bfill:%23FFFFFF;stroke:%23454966;stroke-width:0.5;stroke-miterlimit:10;%7D .st50%7Bfill:%23DDDDDD;%7D .st51%7Bfill:%23FE5245;%7D .st52%7Bfill:%23FE9C39;%7D .st53%7Bfill:%23FFE831;%7D .st54%7Bfill:%237ADFFE;%7D .st55%7Bfill:%2332AE49;%7D .st56%7Bfill:none;%7D .st57%7Bfill:%23454966;stroke:%23454966;stroke-width:0.5;stroke-miterlimit:10;%7D .st58%7Bfill:%23454966;stroke:%23454966;stroke-width:0.5267;stroke-miterlimit:10;%7D .st59%7Bfill:%23454966;stroke:%23454966;stroke-width:0.1953;stroke-miterlimit:10;%7D .st60%7Bfill:%23454966;stroke:%23454966;stroke-width:0.4787;stroke-miterlimit:10;%7D .st61%7Bfill:%23454966;stroke:%23454966;stroke-width:0.0519;stroke-miterlimit:10;%7D .st62%7Bopacity:0.43;%7D .st63%7Bfill:%23454966;stroke:%23454966;stroke-width:0.1042;stroke-miterlimit:10;%7D .st64%7Bfill:%23454966;stroke:%23454966;stroke-width:0.1317;stroke-miterlimit:10;%7D .st65%7Bfill:%23454966;stroke:%23454966;stroke-width:0.1847;stroke-miterlimit:10;%7D .st66%7Bfill:%23454966;stroke:%23454966;stroke-width:0.0673;stroke-miterlimit:10;%7D%0A%3C/style%3E%3Cg%3E%3Cpath class='st64' d='M8.96,11.15c-0.33,0-0.66-0.01-0.98,0c-0.23,0.01-0.33-0.08-0.33-0.32c0.01-0.66,0-1.33,0-1.99 c0-0.12,0-0.23,0.14-0.29c0.12-0.05,0.2,0.03,0.28,0.11C8.25,8.84,8.45,9.01,8.61,9.2c0.13,0.15,0.22,0.12,0.36,0 c1.23-1.09,2.65-1.34,4.19-0.89c1.46,0.43,2.81,1.91,2.94,3.72c0.15,2.1-1.2,4.04-3.25,4.53c-1.39,0.33-2.66,0.04-3.78-0.88 c-0.14-0.12-0.29-0.23-0.11-0.44c0.3-0.35,0.41-0.39,0.65-0.19c1.47,1.22,3.59,1.04,4.83-0.4c1.24-1.43,1.09-3.56-0.33-4.84 c-1.3-1.17-3.28-1.18-4.58-0.02c-0.14,0.13-0.16,0.2-0.01,0.34c0.22,0.19,0.41,0.4,0.61,0.6c0.09,0.08,0.16,0.17,0.1,0.3 c-0.05,0.12-0.16,0.12-0.27,0.12C9.65,11.15,9.31,11.15,8.96,11.15z'/%3E%3Cpath class='st64' d='M12.25,11.17c0,0.34,0.02,0.67-0.01,1.01c-0.01,0.22,0.07,0.34,0.24,0.46c0.3,0.21,0.59,0.44,0.89,0.65 c0.15,0.11,0.17,0.21,0.06,0.37c-0.31,0.46-0.31,0.46-0.76,0.14c-0.36-0.26-0.73-0.53-1.09-0.79c-0.13-0.09-0.18-0.19-0.17-0.35 c0.01-0.85,0-1.7,0-2.55c0-0.31,0.03-0.33,0.34-0.34c0.49,0,0.49,0,0.5,0.5C12.25,10.57,12.25,10.87,12.25,11.17z'/%3E%3C/g%3E%3C/svg%3E%0A");
}

.undoIcon {
    background-image: url("data:image/svg+xml,%3C%3Fxml version='1.0' encoding='utf-8'%3F%3E%3C!-- Generator: Adobe Illustrator 24.3.0, SVG Export Plug-In . SVG Version: 6.00 Build 0) --%3E%3Csvg version='1.1' id='Layer_1' xmlns='http://www.w3.org/2000/svg' xmlns:xlink='http://www.w3.org/1999/xlink' x='0px' y='0px' viewBox='0 0 24 24' style='enable-background:new 0 0 24 24;' xml:space='preserve'%3E%3Cstyle type='text/css'%3E .st0%7Bfill:%23F4F9FF;%7D .st1%7Bfill:%23EF4B3E;%7D .st2%7Bfill:%23754C24;stroke:%23FFFFFF;stroke-width:0.75;stroke-miterlimit:10;%7D .st3%7Bstroke:%23000000;stroke-width:2.856;stroke-miterlimit:10;%7D .st4%7Bfill:none;stroke:%23FFFFFF;stroke-width:2;stroke-miterlimit:10;%7D .st5%7Bfill:%23FFFFFF;%7D .st6%7Bfill:%23F9F9F9;%7D .st7%7Bfill:none;stroke:%23FFFFFF;stroke-width:2.0229;stroke-miterlimit:10;%7D .st8%7Bfill:%23FFFFFF;stroke:%23FFFFFF;stroke-width:0.5;stroke-miterlimit:10;%7D .st9%7Bfill:none;stroke:%23000000;stroke-width:7.6112;stroke-miterlimit:10;%7D .st10%7Bstroke:%23FFFFFF;stroke-miterlimit:10;%7D .st11%7Bfill:none;stroke:%23000000;stroke-width:6.6078;stroke-miterlimit:10;%7D .st12%7Bstroke:%23000000;stroke-width:1.7107;stroke-miterlimit:10;%7D .st13%7Bfill:%23FFFFFF;stroke:%23EF4B3E;stroke-width:0.5304;stroke-miterlimit:10;%7D .st14%7Bfill:%23FFFFFF;stroke:%23FFFFFF;stroke-width:0.406;stroke-miterlimit:10;%7D .st15%7Bfill:none;stroke:%23FFFFFF;stroke-width:1.0951;stroke-miterlimit:10;%7D .st16%7Bfill:%23FFFFFF;stroke:%23FFFFFF;stroke-width:0.2707;stroke-miterlimit:10;%7D .st17%7Bfill:%23FFFFFF;stroke:%23FFFFFF;stroke-width:0.3006;stroke-miterlimit:10;%7D .st18%7Bstroke:%23000000;stroke-width:0.25;stroke-miterlimit:10;%7D .st19%7Bfill:%23EF4B3E;stroke:%23EF4B3E;stroke-width:0.5;stroke-miterlimit:10;%7D .st20%7Bfill:%23EF4B3E;stroke:%23EF4B3E;stroke-width:0.5497;stroke-miterlimit:10;%7D .st21%7Bfill:%23FFFFFF;stroke:%23FFFFFF;stroke-width:0.5497;stroke-miterlimit:10;%7D .st22%7Bfill:%23898989;%7D .st23%7Bfill:%23212529;%7D .st24%7Bfill:%23898989;stroke:%23898989;stroke-width:0.25;stroke-miterlimit:10;%7D .st25%7Bfill:%23898989;stroke:%23212529;stroke-width:0.25;stroke-miterlimit:10;%7D .st26%7Bfill:%23898989;stroke:%23212529;stroke-width:0.1275;stroke-miterlimit:10;%7D .st27%7Bfill:%23898989;stroke:%23212529;stroke-width:0.0697;stroke-miterlimit:10;%7D .st28%7Bfill:%23FF0000;%7D .st29%7Bfill:%23FFFF00;%7D .st30%7Bfill:%2300FF00;%7D .st31%7Bfill:%2300FFFF;%7D .st32%7Bfill:%230000FF;%7D .st33%7Bfill:%23FF00FF;%7D .st34%7Bfill:%23C1272D;%7D .st35%7Bfill:%23F15A24;%7D .st36%7Bfill:%23F7931E;%7D .st37%7Bfill:%23FCEE21;%7D .st38%7Bfill:%238CC63F;%7D .st39%7Bfill:%23006837;%7D .st40%7Bfill:%23ED1E79;%7D .st41%7Bfill:%23603813;%7D .st42%7Bfill:%23FFFFFF;stroke:%23000000;stroke-width:0.4185;stroke-miterlimit:10;%7D .st43%7Bfill:%23454966;stroke:%23454966;stroke-width:0.3101;stroke-miterlimit:10;%7D .st44%7Bfill:%23454966;stroke:%23454966;stroke-miterlimit:10;%7D .st45%7Bfill:%23454966;stroke:%23454966;stroke-width:0.75;stroke-miterlimit:10;%7D .st46%7Bfill:%23454966;%7D .st47%7Bfill:%23454966;stroke:%23454966;stroke-width:0.3041;stroke-miterlimit:10;%7D .st48%7Bfill:%23202020;%7D .st49%7Bfill:%23FFFFFF;stroke:%23454966;stroke-width:0.5;stroke-miterlimit:10;%7D .st50%7Bfill:%23DDDDDD;%7D .st51%7Bfill:%23FE5245;%7D .st52%7Bfill:%23FE9C39;%7D .st53%7Bfill:%23FFE831;%7D .st54%7Bfill:%237ADFFE;%7D .st55%7Bfill:%2332AE49;%7D .st56%7Bfill:none;%7D .st57%7Bfill:%23454966;stroke:%23454966;stroke-width:0.5;stroke-miterlimit:10;%7D .st58%7Bfill:%23454966;stroke:%23454966;stroke-width:0.5267;stroke-miterlimit:10;%7D .st59%7Bfill:%23454966;stroke:%23454966;stroke-width:0.1953;stroke-miterlimit:10;%7D .st60%7Bfill:%23454966;stroke:%23454966;stroke-width:0.4787;stroke-miterlimit:10;%7D .st61%7Bfill:%23454966;stroke:%23454966;stroke-width:0.0519;stroke-miterlimit:10;%7D .st62%7Bopacity:0.43;%7D .st63%7Bfill:%23454966;stroke:%23454966;stroke-width:0.1042;stroke-miterlimit:10;%7D .st64%7Bfill:%23454966;stroke:%23454966;stroke-width:0.1317;stroke-miterlimit:10;%7D .st65%7Bfill:%23454966;stroke:%23454966;stroke-width:0.1847;stroke-miterlimit:10;%7D .st66%7Bfill:%23454966;stroke:%23454966;stroke-width:0.0673;stroke-miterlimit:10;%7D%0A%3C/style%3E%3Cg%3E%3Cg%3E%3Cpath class='st58' d='M9.88,10.21c0.27,0.23,0.54,0.45,0.79,0.69c0.07,0.07,0.15,0.21,0.13,0.29c-0.02,0.08-0.17,0.16-0.26,0.16 c-0.71,0.01-1.43,0.02-2.14-0.01c-0.11,0-0.3-0.19-0.3-0.3C8.07,10.33,8.08,9.62,8.09,8.9c0-0.1,0.09-0.2,0.18-0.38 c0.36,0.34,0.68,0.64,1.04,0.99c0.64-0.65,1.42-0.99,2.31-1.14c2.04-0.33,4.2,1.24,4.52,3.29c0.39,2.54-1.37,4.71-3.95,4.79 c-0.94,0.03-1.8-0.28-2.54-0.87c-0.18-0.15-0.41-0.27-0.16-0.55c0.21-0.23,0.38-0.35,0.71-0.14c0.41,0.26,0.87,0.48,1.34,0.6 c1.23,0.3,2.55-0.26,3.25-1.32c0.71-1.07,0.71-2.51-0.01-3.57c-0.7-1.04-2.04-1.59-3.26-1.33C10.93,9.4,10.38,9.63,9.88,10.21z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E%0A");
}

.redoIcon {
    background-image: url("data:image/svg+xml,%3C%3Fxml version='1.0' encoding='utf-8'%3F%3E%3C!-- Generator: Adobe Illustrator 24.3.0, SVG Export Plug-In . SVG Version: 6.00 Build 0) --%3E%3Csvg version='1.1' id='Layer_1' xmlns='http://www.w3.org/2000/svg' xmlns:xlink='http://www.w3.org/1999/xlink' x='0px' y='0px' viewBox='0 0 24 24' style='enable-background:new 0 0 24 24;' xml:space='preserve'%3E%3Cstyle type='text/css'%3E .st0%7Bfill:%23F4F9FF;%7D .st1%7Bfill:%23EF4B3E;%7D .st2%7Bfill:%23754C24;stroke:%23FFFFFF;stroke-width:0.75;stroke-miterlimit:10;%7D .st3%7Bstroke:%23000000;stroke-width:2.856;stroke-miterlimit:10;%7D .st4%7Bfill:none;stroke:%23FFFFFF;stroke-width:2;stroke-miterlimit:10;%7D .st5%7Bfill:%23FFFFFF;%7D .st6%7Bfill:%23F9F9F9;%7D .st7%7Bfill:none;stroke:%23FFFFFF;stroke-width:2.0229;stroke-miterlimit:10;%7D .st8%7Bfill:%23FFFFFF;stroke:%23FFFFFF;stroke-width:0.5;stroke-miterlimit:10;%7D .st9%7Bfill:none;stroke:%23000000;stroke-width:7.6112;stroke-miterlimit:10;%7D .st10%7Bstroke:%23FFFFFF;stroke-miterlimit:10;%7D .st11%7Bfill:none;stroke:%23000000;stroke-width:6.6078;stroke-miterlimit:10;%7D .st12%7Bstroke:%23000000;stroke-width:1.7107;stroke-miterlimit:10;%7D .st13%7Bfill:%23FFFFFF;stroke:%23EF4B3E;stroke-width:0.5304;stroke-miterlimit:10;%7D .st14%7Bfill:%23FFFFFF;stroke:%23FFFFFF;stroke-width:0.406;stroke-miterlimit:10;%7D .st15%7Bfill:none;stroke:%23FFFFFF;stroke-width:1.0951;stroke-miterlimit:10;%7D .st16%7Bfill:%23FFFFFF;stroke:%23FFFFFF;stroke-width:0.2707;stroke-miterlimit:10;%7D .st17%7Bfill:%23FFFFFF;stroke:%23FFFFFF;stroke-width:0.3006;stroke-miterlimit:10;%7D .st18%7Bstroke:%23000000;stroke-width:0.25;stroke-miterlimit:10;%7D .st19%7Bfill:%23EF4B3E;stroke:%23EF4B3E;stroke-width:0.5;stroke-miterlimit:10;%7D .st20%7Bfill:%23EF4B3E;stroke:%23EF4B3E;stroke-width:0.5497;stroke-miterlimit:10;%7D .st21%7Bfill:%23FFFFFF;stroke:%23FFFFFF;stroke-width:0.5497;stroke-miterlimit:10;%7D .st22%7Bfill:%23898989;%7D .st23%7Bfill:%23212529;%7D .st24%7Bfill:%23898989;stroke:%23898989;stroke-width:0.25;stroke-miterlimit:10;%7D .st25%7Bfill:%23898989;stroke:%23212529;stroke-width:0.25;stroke-miterlimit:10;%7D .st26%7Bfill:%23898989;stroke:%23212529;stroke-width:0.1275;stroke-miterlimit:10;%7D .st27%7Bfill:%23898989;stroke:%23212529;stroke-width:0.0697;stroke-miterlimit:10;%7D .st28%7Bfill:%23FF0000;%7D .st29%7Bfill:%23FFFF00;%7D .st30%7Bfill:%2300FF00;%7D .st31%7Bfill:%2300FFFF;%7D .st32%7Bfill:%230000FF;%7D .st33%7Bfill:%23FF00FF;%7D .st34%7Bfill:%23C1272D;%7D .st35%7Bfill:%23F15A24;%7D .st36%7Bfill:%23F7931E;%7D .st37%7Bfill:%23FCEE21;%7D .st38%7Bfill:%238CC63F;%7D .st39%7Bfill:%23006837;%7D .st40%7Bfill:%23ED1E79;%7D .st41%7Bfill:%23603813;%7D .st42%7Bfill:%23FFFFFF;stroke:%23000000;stroke-width:0.4185;stroke-miterlimit:10;%7D .st43%7Bfill:%23454966;stroke:%23454966;stroke-width:0.3101;stroke-miterlimit:10;%7D .st44%7Bfill:%23454966;stroke:%23454966;stroke-miterlimit:10;%7D .st45%7Bfill:%23454966;stroke:%23454966;stroke-width:0.75;stroke-miterlimit:10;%7D .st46%7Bfill:%23454966;%7D .st47%7Bfill:%23454966;stroke:%23454966;stroke-width:0.3041;stroke-miterlimit:10;%7D .st48%7Bfill:%23202020;%7D .st49%7Bfill:%23FFFFFF;stroke:%23454966;stroke-width:0.5;stroke-miterlimit:10;%7D .st50%7Bfill:%23DDDDDD;%7D .st51%7Bfill:%23FE5245;%7D .st52%7Bfill:%23FE9C39;%7D .st53%7Bfill:%23FFE831;%7D .st54%7Bfill:%237ADFFE;%7D .st55%7Bfill:%2332AE49;%7D .st56%7Bfill:none;%7D .st57%7Bfill:%23454966;stroke:%23454966;stroke-width:0.5;stroke-miterlimit:10;%7D .st58%7Bfill:%23454966;stroke:%23454966;stroke-width:0.5267;stroke-miterlimit:10;%7D .st59%7Bfill:%23454966;stroke:%23454966;stroke-width:0.1953;stroke-miterlimit:10;%7D .st60%7Bfill:%23454966;stroke:%23454966;stroke-width:0.4787;stroke-miterlimit:10;%7D .st61%7Bfill:%23454966;stroke:%23454966;stroke-width:0.0519;stroke-miterlimit:10;%7D .st62%7Bopacity:0.43;%7D .st63%7Bfill:%23454966;stroke:%23454966;stroke-width:0.1042;stroke-miterlimit:10;%7D .st64%7Bfill:%23454966;stroke:%23454966;stroke-width:0.1317;stroke-miterlimit:10;%7D .st65%7Bfill:%23454966;stroke:%23454966;stroke-width:0.1847;stroke-miterlimit:10;%7D .st66%7Bfill:%23454966;stroke:%23454966;stroke-width:0.0673;stroke-miterlimit:10;%7D%0A%3C/style%3E%3Cg%3E%3Cg%3E%3Cpath class='st58' d='M14.36,10.21c-0.27,0.23-0.54,0.45-0.79,0.69c-0.07,0.07-0.15,0.21-0.13,0.29c0.02,0.08,0.17,0.16,0.26,0.16 c0.71,0.01,1.43,0.02,2.14-0.01c0.11,0,0.3-0.19,0.3-0.3c0.03-0.71,0.02-1.43,0.01-2.14c0-0.1-0.09-0.2-0.18-0.38 c-0.36,0.34-0.68,0.64-1.04,0.99c-0.64-0.65-1.42-0.99-2.31-1.14c-2.04-0.33-4.2,1.24-4.52,3.29c-0.39,2.54,1.37,4.71,3.95,4.79 c0.94,0.03,1.8-0.28,2.54-0.87c0.18-0.15,0.41-0.27,0.16-0.55c-0.21-0.23-0.38-0.35-0.71-0.14c-0.41,0.26-0.87,0.48-1.34,0.6 c-1.23,0.3-2.55-0.26-3.25-1.32c-0.71-1.07-0.71-2.51,0.01-3.57c0.7-1.04,2.04-1.59,3.26-1.33C13.31,9.4,13.86,9.63,14.36,10.21z' /%3E%3C/g%3E%3C/g%3E%3C/svg%3E%0A");
}

.prevPageIcon {
    background-image: url("data:image/svg+xml,%3C%3Fxml version='1.0' encoding='utf-8'%3F%3E%3C!-- Generator: Adobe Illustrator 24.3.0, SVG Export Plug-In . SVG Version: 6.00 Build 0) --%3E%3Csvg version='1.1' id='Layer_1' xmlns='http://www.w3.org/2000/svg' xmlns:xlink='http://www.w3.org/1999/xlink' x='0px' y='0px' viewBox='0 0 24 24' style='enable-background:new 0 0 24 24;' xml:space='preserve'%3E%3Cstyle type='text/css'%3E .st0%7Bfill:%23F4F9FF;%7D .st1%7Bfill:%23EF4B3E;%7D .st2%7Bfill:%23754C24;stroke:%23FFFFFF;stroke-width:0.75;stroke-miterlimit:10;%7D .st3%7Bstroke:%23000000;stroke-width:2.856;stroke-miterlimit:10;%7D .st4%7Bfill:none;stroke:%23FFFFFF;stroke-width:2;stroke-miterlimit:10;%7D .st5%7Bfill:%23FFFFFF;%7D .st6%7Bfill:%23F9F9F9;%7D .st7%7Bfill:none;stroke:%23FFFFFF;stroke-width:2.0229;stroke-miterlimit:10;%7D .st8%7Bfill:%23FFFFFF;stroke:%23FFFFFF;stroke-width:0.5;stroke-miterlimit:10;%7D .st9%7Bfill:none;stroke:%23000000;stroke-width:7.6112;stroke-miterlimit:10;%7D .st10%7Bstroke:%23FFFFFF;stroke-miterlimit:10;%7D .st11%7Bfill:none;stroke:%23000000;stroke-width:6.6078;stroke-miterlimit:10;%7D .st12%7Bstroke:%23000000;stroke-width:1.7107;stroke-miterlimit:10;%7D .st13%7Bfill:%23FFFFFF;stroke:%23EF4B3E;stroke-width:0.5304;stroke-miterlimit:10;%7D .st14%7Bfill:%23FFFFFF;stroke:%23FFFFFF;stroke-width:0.406;stroke-miterlimit:10;%7D .st15%7Bfill:none;stroke:%23FFFFFF;stroke-width:1.0951;stroke-miterlimit:10;%7D .st16%7Bfill:%23FFFFFF;stroke:%23FFFFFF;stroke-width:0.2707;stroke-miterlimit:10;%7D .st17%7Bfill:%23FFFFFF;stroke:%23FFFFFF;stroke-width:0.3006;stroke-miterlimit:10;%7D .st18%7Bstroke:%23000000;stroke-width:0.25;stroke-miterlimit:10;%7D .st19%7Bfill:%23EF4B3E;stroke:%23EF4B3E;stroke-width:0.5;stroke-miterlimit:10;%7D .st20%7Bfill:%23EF4B3E;stroke:%23EF4B3E;stroke-width:0.5497;stroke-miterlimit:10;%7D .st21%7Bfill:%23FFFFFF;stroke:%23FFFFFF;stroke-width:0.5497;stroke-miterlimit:10;%7D .st22%7Bfill:%23898989;%7D .st23%7Bfill:%23212529;%7D .st24%7Bfill:%23898989;stroke:%23898989;stroke-width:0.25;stroke-miterlimit:10;%7D .st25%7Bfill:%23898989;stroke:%23212529;stroke-width:0.25;stroke-miterlimit:10;%7D .st26%7Bfill:%23898989;stroke:%23212529;stroke-width:0.1275;stroke-miterlimit:10;%7D .st27%7Bfill:%23898989;stroke:%23212529;stroke-width:0.0697;stroke-miterlimit:10;%7D .st28%7Bfill:%23FF0000;%7D .st29%7Bfill:%23FFFF00;%7D .st30%7Bfill:%2300FF00;%7D .st31%7Bfill:%2300FFFF;%7D .st32%7Bfill:%230000FF;%7D .st33%7Bfill:%23FF00FF;%7D .st34%7Bfill:%23C1272D;%7D .st35%7Bfill:%23F15A24;%7D .st36%7Bfill:%23F7931E;%7D .st37%7Bfill:%23FCEE21;%7D .st38%7Bfill:%238CC63F;%7D .st39%7Bfill:%23006837;%7D .st40%7Bfill:%23ED1E79;%7D .st41%7Bfill:%23603813;%7D .st42%7Bfill:%23FFFFFF;stroke:%23000000;stroke-width:0.4185;stroke-miterlimit:10;%7D .st43%7Bfill:%23454966;stroke:%23454966;stroke-width:0.3101;stroke-miterlimit:10;%7D .st44%7Bfill:%23454966;stroke:%23454966;stroke-miterlimit:10;%7D .st45%7Bfill:%23454966;stroke:%23454966;stroke-width:0.75;stroke-miterlimit:10;%7D .st46%7Bfill:%23454966;%7D .st47%7Bfill:%23454966;stroke:%23454966;stroke-width:0.3041;stroke-miterlimit:10;%7D .st48%7Bfill:%23202020;%7D .st49%7Bfill:%23FFFFFF;stroke:%23454966;stroke-width:0.5;stroke-miterlimit:10;%7D .st50%7Bfill:%23DDDDDD;%7D .st51%7Bfill:%23FE5245;%7D .st52%7Bfill:%23FE9C39;%7D .st53%7Bfill:%23FFE831;%7D .st54%7Bfill:%237ADFFE;%7D .st55%7Bfill:%2332AE49;%7D .st56%7Bfill:none;%7D .st57%7Bfill:%23454966;stroke:%23454966;stroke-width:0.5;stroke-miterlimit:10;%7D .st58%7Bfill:%23454966;stroke:%23454966;stroke-width:0.5267;stroke-miterlimit:10;%7D .st59%7Bfill:%23454966;stroke:%23454966;stroke-width:0.1953;stroke-miterlimit:10;%7D .st60%7Bfill:%23454966;stroke:%23454966;stroke-width:0.4787;stroke-miterlimit:10;%7D .st61%7Bfill:%23454966;stroke:%23454966;stroke-width:0.0519;stroke-miterlimit:10;%7D .st62%7Bopacity:0.43;%7D .st63%7Bfill:%23454966;stroke:%23454966;stroke-width:0.1042;stroke-miterlimit:10;%7D .st64%7Bfill:%23454966;stroke:%23454966;stroke-width:0.1317;stroke-miterlimit:10;%7D .st65%7Bfill:%23454966;stroke:%23454966;stroke-width:0.1847;stroke-miterlimit:10;%7D .st66%7Bfill:%23454966;stroke:%23454966;stroke-width:0.0673;stroke-miterlimit:10;%7D%0A%3C/style%3E%3Cg class='st62'%3E%3Cg%3E%3Ccircle class='st0' cx='11.89' cy='12.33' r='10.75'/%3E%3C/g%3E%3Cg%3E%3Cpath class='st66' d='M10.52,11.31c0.62-0.61,1.17-1.15,1.71-1.7c0.44-0.44,0.44-0.8,0.01-1.23c-0.7-0.72-0.92-0.72-1.64,0 c-1.09,1.09-2.19,2.19-3.28,3.28C6.83,12.15,6.83,12.5,7.33,13c1.14,1.14,2.28,2.28,3.43,3.43c0.51,0.51,0.82,0.51,1.33,0.01 c0.07-0.07,0.15-0.14,0.22-0.22c0.34-0.37,0.35-0.75,0-1.11c-0.48-0.5-0.98-0.98-1.47-1.47c-0.08-0.08-0.19-0.12-0.32-0.2 c0.22-0.12,0.33-0.09,0.44-0.09c1.65,0,3.3,0,4.95,0c0.7,0,0.92-0.22,0.92-0.92c0-0.09,0-0.18,0-0.27 c-0.01-0.58-0.26-0.83-0.83-0.83c-1.29,0-2.57,0-3.86,0C11.63,11.31,11.13,11.31,10.52,11.31z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E%0A");
}

.nextPageIcon {
    background-image: url("data:image/svg+xml,%3C%3Fxml version='1.0' encoding='utf-8'%3F%3E%3C!-- Generator: Adobe Illustrator 24.3.0, SVG Export Plug-In . SVG Version: 6.00 Build 0) --%3E%3Csvg version='1.1' id='Layer_1' xmlns='http://www.w3.org/2000/svg' xmlns:xlink='http://www.w3.org/1999/xlink' x='0px' y='0px' viewBox='0 0 24 24' style='enable-background:new 0 0 24 24;' xml:space='preserve'%3E%3Cstyle type='text/css'%3E .st0%7Bfill:%23F4F9FF;%7D .st1%7Bfill:%23EF4B3E;%7D .st2%7Bfill:%23754C24;stroke:%23FFFFFF;stroke-width:0.75;stroke-miterlimit:10;%7D .st3%7Bstroke:%23000000;stroke-width:2.856;stroke-miterlimit:10;%7D .st4%7Bfill:none;stroke:%23FFFFFF;stroke-width:2;stroke-miterlimit:10;%7D .st5%7Bfill:%23FFFFFF;%7D .st6%7Bfill:%23F9F9F9;%7D .st7%7Bfill:none;stroke:%23FFFFFF;stroke-width:2.0229;stroke-miterlimit:10;%7D .st8%7Bfill:%23FFFFFF;stroke:%23FFFFFF;stroke-width:0.5;stroke-miterlimit:10;%7D .st9%7Bfill:none;stroke:%23000000;stroke-width:7.6112;stroke-miterlimit:10;%7D .st10%7Bstroke:%23FFFFFF;stroke-miterlimit:10;%7D .st11%7Bfill:none;stroke:%23000000;stroke-width:6.6078;stroke-miterlimit:10;%7D .st12%7Bstroke:%23000000;stroke-width:1.7107;stroke-miterlimit:10;%7D .st13%7Bfill:%23FFFFFF;stroke:%23EF4B3E;stroke-width:0.5304;stroke-miterlimit:10;%7D .st14%7Bfill:%23FFFFFF;stroke:%23FFFFFF;stroke-width:0.406;stroke-miterlimit:10;%7D .st15%7Bfill:none;stroke:%23FFFFFF;stroke-width:1.0951;stroke-miterlimit:10;%7D .st16%7Bfill:%23FFFFFF;stroke:%23FFFFFF;stroke-width:0.2707;stroke-miterlimit:10;%7D .st17%7Bfill:%23FFFFFF;stroke:%23FFFFFF;stroke-width:0.3006;stroke-miterlimit:10;%7D .st18%7Bstroke:%23000000;stroke-width:0.25;stroke-miterlimit:10;%7D .st19%7Bfill:%23EF4B3E;stroke:%23EF4B3E;stroke-width:0.5;stroke-miterlimit:10;%7D .st20%7Bfill:%23EF4B3E;stroke:%23EF4B3E;stroke-width:0.5497;stroke-miterlimit:10;%7D .st21%7Bfill:%23FFFFFF;stroke:%23FFFFFF;stroke-width:0.5497;stroke-miterlimit:10;%7D .st22%7Bfill:%23898989;%7D .st23%7Bfill:%23212529;%7D .st24%7Bfill:%23898989;stroke:%23898989;stroke-width:0.25;stroke-miterlimit:10;%7D .st25%7Bfill:%23898989;stroke:%23212529;stroke-width:0.25;stroke-miterlimit:10;%7D .st26%7Bfill:%23898989;stroke:%23212529;stroke-width:0.1275;stroke-miterlimit:10;%7D .st27%7Bfill:%23898989;stroke:%23212529;stroke-width:0.0697;stroke-miterlimit:10;%7D .st28%7Bfill:%23FF0000;%7D .st29%7Bfill:%23FFFF00;%7D .st30%7Bfill:%2300FF00;%7D .st31%7Bfill:%2300FFFF;%7D .st32%7Bfill:%230000FF;%7D .st33%7Bfill:%23FF00FF;%7D .st34%7Bfill:%23C1272D;%7D .st35%7Bfill:%23F15A24;%7D .st36%7Bfill:%23F7931E;%7D .st37%7Bfill:%23FCEE21;%7D .st38%7Bfill:%238CC63F;%7D .st39%7Bfill:%23006837;%7D .st40%7Bfill:%23ED1E79;%7D .st41%7Bfill:%23603813;%7D .st42%7Bfill:%23FFFFFF;stroke:%23000000;stroke-width:0.4185;stroke-miterlimit:10;%7D .st43%7Bfill:%23454966;stroke:%23454966;stroke-width:0.3101;stroke-miterlimit:10;%7D .st44%7Bfill:%23454966;stroke:%23454966;stroke-miterlimit:10;%7D .st45%7Bfill:%23454966;stroke:%23454966;stroke-width:0.75;stroke-miterlimit:10;%7D .st46%7Bfill:%23454966;%7D .st47%7Bfill:%23454966;stroke:%23454966;stroke-width:0.3041;stroke-miterlimit:10;%7D .st48%7Bfill:%23202020;%7D .st49%7Bfill:%23FFFFFF;stroke:%23454966;stroke-width:0.5;stroke-miterlimit:10;%7D .st50%7Bfill:%23DDDDDD;%7D .st51%7Bfill:%23FE5245;%7D .st52%7Bfill:%23FE9C39;%7D .st53%7Bfill:%23FFE831;%7D .st54%7Bfill:%237ADFFE;%7D .st55%7Bfill:%2332AE49;%7D .st56%7Bfill:none;%7D .st57%7Bfill:%23454966;stroke:%23454966;stroke-width:0.5;stroke-miterlimit:10;%7D .st58%7Bfill:%23454966;stroke:%23454966;stroke-width:0.5267;stroke-miterlimit:10;%7D .st59%7Bfill:%23454966;stroke:%23454966;stroke-width:0.1953;stroke-miterlimit:10;%7D .st60%7Bfill:%23454966;stroke:%23454966;stroke-width:0.4787;stroke-miterlimit:10;%7D .st61%7Bfill:%23454966;stroke:%23454966;stroke-width:0.0519;stroke-miterlimit:10;%7D .st62%7Bopacity:0.43;%7D .st63%7Bfill:%23454966;stroke:%23454966;stroke-width:0.1042;stroke-miterlimit:10;%7D .st64%7Bfill:%23454966;stroke:%23454966;stroke-width:0.1317;stroke-miterlimit:10;%7D .st65%7Bfill:%23454966;stroke:%23454966;stroke-width:0.1847;stroke-miterlimit:10;%7D .st66%7Bfill:%23454966;stroke:%23454966;stroke-width:0.0673;stroke-miterlimit:10;%7D%0A%3C/style%3E%3Cg class='st62'%3E%3Cg%3E%3Ccircle class='st0' cx='11.74' cy='12.33' r='10.75'/%3E%3C/g%3E%3Cg%3E%3Cpath class='st66' d='M13.1,11.31c-0.62-0.61-1.17-1.15-1.71-1.7c-0.44-0.44-0.44-0.8-0.01-1.23c0.7-0.72,0.92-0.72,1.64,0 c1.09,1.09,2.19,2.19,3.28,3.28c0.49,0.49,0.49,0.83-0.01,1.33c-1.14,1.14-2.28,2.28-3.43,3.43c-0.51,0.51-0.82,0.51-1.33,0.01 c-0.07-0.07-0.15-0.14-0.22-0.22c-0.34-0.37-0.35-0.75,0-1.11c0.48-0.5,0.98-0.98,1.47-1.47c0.08-0.08,0.19-0.12,0.32-0.2 c-0.22-0.12-0.33-0.09-0.44-0.09c-1.65,0-3.3,0-4.95,0c-0.7,0-0.92-0.22-0.92-0.92c0-0.09,0-0.18,0-0.27 c0.01-0.58,0.26-0.83,0.83-0.83c1.29,0,2.57,0,3.86,0C12,11.31,12.5,11.31,13.1,11.31z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E%0A");
}

.menuIcon {
    background-image: url("data:image/svg+xml,%3C%3Fxml version='1.0' encoding='utf-8'%3F%3E%3C!-- Generator: Adobe Illustrator 24.3.0, SVG Export Plug-In . SVG Version: 6.00 Build 0) --%3E%3Csvg version='1.1' id='Layer_1' xmlns='http://www.w3.org/2000/svg' xmlns:xlink='http://www.w3.org/1999/xlink' x='0px' y='0px' viewBox='0 0 24 24' style='enable-background:new 0 0 24 24;' xml:space='preserve'%3E%3Cstyle type='text/css'%3E .st0%7Bfill:%23F4F9FF;%7D .st1%7Bfill:%23EF4B3E;%7D .st2%7Bfill:%23754C24;stroke:%23FFFFFF;stroke-width:0.75;stroke-miterlimit:10;%7D .st3%7Bstroke:%23000000;stroke-width:2.856;stroke-miterlimit:10;%7D .st4%7Bfill:none;stroke:%23FFFFFF;stroke-width:2;stroke-miterlimit:10;%7D .st5%7Bfill:%23FFFFFF;%7D .st6%7Bfill:%23F9F9F9;%7D .st7%7Bfill:none;stroke:%23FFFFFF;stroke-width:2.0229;stroke-miterlimit:10;%7D .st8%7Bfill:%23FFFFFF;stroke:%23FFFFFF;stroke-width:0.5;stroke-miterlimit:10;%7D .st9%7Bfill:none;stroke:%23000000;stroke-width:7.6112;stroke-miterlimit:10;%7D .st10%7Bstroke:%23FFFFFF;stroke-miterlimit:10;%7D .st11%7Bfill:none;stroke:%23000000;stroke-width:6.6078;stroke-miterlimit:10;%7D .st12%7Bstroke:%23000000;stroke-width:1.7107;stroke-miterlimit:10;%7D .st13%7Bfill:%23FFFFFF;stroke:%23EF4B3E;stroke-width:0.5304;stroke-miterlimit:10;%7D .st14%7Bfill:%23FFFFFF;stroke:%23FFFFFF;stroke-width:0.406;stroke-miterlimit:10;%7D .st15%7Bfill:none;stroke:%23FFFFFF;stroke-width:1.0951;stroke-miterlimit:10;%7D .st16%7Bfill:%23FFFFFF;stroke:%23FFFFFF;stroke-width:0.2707;stroke-miterlimit:10;%7D .st17%7Bfill:%23FFFFFF;stroke:%23FFFFFF;stroke-width:0.3006;stroke-miterlimit:10;%7D .st18%7Bstroke:%23000000;stroke-width:0.25;stroke-miterlimit:10;%7D .st19%7Bfill:%23EF4B3E;stroke:%23EF4B3E;stroke-width:0.5;stroke-miterlimit:10;%7D .st20%7Bfill:%23EF4B3E;stroke:%23EF4B3E;stroke-width:0.5497;stroke-miterlimit:10;%7D .st21%7Bfill:%23FFFFFF;stroke:%23FFFFFF;stroke-width:0.5497;stroke-miterlimit:10;%7D .st22%7Bfill:%23898989;%7D .st23%7Bfill:%23212529;%7D .st24%7Bfill:%23898989;stroke:%23898989;stroke-width:0.25;stroke-miterlimit:10;%7D .st25%7Bfill:%23898989;stroke:%23212529;stroke-width:0.25;stroke-miterlimit:10;%7D .st26%7Bfill:%23898989;stroke:%23212529;stroke-width:0.1275;stroke-miterlimit:10;%7D .st27%7Bfill:%23898989;stroke:%23212529;stroke-width:0.0697;stroke-miterlimit:10;%7D .st28%7Bfill:%23FF0000;%7D .st29%7Bfill:%23FFFF00;%7D .st30%7Bfill:%2300FF00;%7D .st31%7Bfill:%2300FFFF;%7D .st32%7Bfill:%230000FF;%7D .st33%7Bfill:%23FF00FF;%7D .st34%7Bfill:%23C1272D;%7D .st35%7Bfill:%23F15A24;%7D .st36%7Bfill:%23F7931E;%7D .st37%7Bfill:%23FCEE21;%7D .st38%7Bfill:%238CC63F;%7D .st39%7Bfill:%23006837;%7D .st40%7Bfill:%23ED1E79;%7D .st41%7Bfill:%23603813;%7D .st42%7Bfill:%23FFFFFF;stroke:%23000000;stroke-width:0.4185;stroke-miterlimit:10;%7D .st43%7Bfill:%23454966;stroke:%23454966;stroke-width:0.3101;stroke-miterlimit:10;%7D .st44%7Bfill:%23454966;stroke:%23454966;stroke-miterlimit:10;%7D .st45%7Bfill:%23454966;stroke:%23454966;stroke-width:0.75;stroke-miterlimit:10;%7D .st46%7Bfill:%23454966;%7D .st47%7Bfill:%23454966;stroke:%23454966;stroke-width:0.3041;stroke-miterlimit:10;%7D .st48%7Bfill:%23202020;%7D .st49%7Bfill:%23FFFFFF;stroke:%23454966;stroke-width:0.5;stroke-miterlimit:10;%7D .st50%7Bfill:%23DDDDDD;%7D .st51%7Bfill:%23FE5245;%7D .st52%7Bfill:%23FE9C39;%7D .st53%7Bfill:%23FFE831;%7D .st54%7Bfill:%237ADFFE;%7D .st55%7Bfill:%2332AE49;%7D .st56%7Bfill:none;%7D .st57%7Bfill:%23454966;stroke:%23454966;stroke-width:0.5;stroke-miterlimit:10;%7D .st58%7Bfill:%23454966;stroke:%23454966;stroke-width:0.5267;stroke-miterlimit:10;%7D .st59%7Bfill:%23454966;stroke:%23454966;stroke-width:0.1953;stroke-miterlimit:10;%7D .st60%7Bfill:%23454966;stroke:%23454966;stroke-width:0.4787;stroke-miterlimit:10;%7D .st61%7Bfill:%23454966;stroke:%23454966;stroke-width:0.0519;stroke-miterlimit:10;%7D .st62%7Bopacity:0.43;%7D .st63%7Bfill:%23454966;stroke:%23454966;stroke-width:0.1042;stroke-miterlimit:10;%7D .st64%7Bfill:%23454966;stroke:%23454966;stroke-width:0.1317;stroke-miterlimit:10;%7D .st65%7Bfill:%23454966;stroke:%23454966;stroke-width:0.1847;stroke-miterlimit:10;%7D .st66%7Bfill:%23454966;stroke:%23454966;stroke-width:0.0673;stroke-miterlimit:10;%7D%0A%3C/style%3E%3Cg%3E%3Cg%3E%3Cpath class='st65' d='M11.96,9.14c-1.5,0-3,0-4.5,0c-0.48,0-0.52-0.04-0.53-0.51c0-0.12,0-0.24,0-0.36c-0.01-0.27,0.1-0.4,0.4-0.4 c3.08,0.01,6.16,0.01,9.24,0c0.27,0,0.37,0.11,0.39,0.37C17,9.14,17.01,9.14,16.1,9.14C14.72,9.14,13.34,9.14,11.96,9.14z'/%3E%3Cpath class='st65' d='M11.91,12.7c-1.5,0-3-0.01-4.5,0.01c-0.36,0-0.52-0.12-0.49-0.48c0-0.01,0-0.03,0-0.04 c-0.01-0.75-0.01-0.75,0.72-0.75c2.91,0,5.82,0,8.72,0c0.57,0,0.57,0.01,0.58,0.57c0,0.08-0.01,0.16,0,0.24 c0.03,0.34-0.11,0.46-0.46,0.46C14.97,12.69,13.44,12.7,11.91,12.7z'/%3E%3Cpath class='st65' d='M11.95,16.25c-1.51,0-3.03-0.01-4.54,0.01c-0.37,0-0.51-0.13-0.48-0.48c0-0.03,0-0.05,0-0.08 c-0.01-0.71-0.01-0.71,0.68-0.71c2.93,0,5.87,0,8.8,0c0.51,0,0.53,0.02,0.53,0.53c0,0.09-0.01,0.18,0,0.28 c0.03,0.34-0.12,0.46-0.46,0.46C14.98,16.25,13.46,16.25,11.95,16.25z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E%0A");
}

@media (max-width: 400px) {
    .colorPicker {
        transform-origin: 0 0;
        transform: scale(1.2);
    }
}
`);

    parent.appendChild(draw);

    if (persistentData) {
        draw.call("DrawingModel", "loadPersistentData", persistentData);
    }
}

import {ButtonRowModel, ButtonRowView} from "./buttonRow.js";

export const drawing = {
    expanders: [DrawingModel, DrawingBackgroundModel, DrawingBackgroundView, DrawingCanvasModel, DrawingCanvasView, ButtonRowModel, ButtonRowView],
    functions: [drawingStart],
};

define([
    'LibreBarcode/errors'
  , 'LibreBarcode/validation'
  , 'Atem-Pen-Case/pens/AbstractPen'
  , 'Atem-Math-Tools/transform'
  , 'Atem-Pen-Case/pens/TransformPointPen'
], function(
    errors
  , validation
  , AbstractPen
  , transform
  , TransformPointPen
) {
    "use strict";

    var Transform = transform.Transform;

    // TODO: move this to Atem-Pen-Case
    var SegmentToPointPen = (function(Parent, errors) {

    var assert = errors.assert;

    // TODO:implement in Atem-Pen-Case
    function GuessSmoothPointPen(){
        throw new Error('GuessSmoothPointPen is not implemented.');
    }

    /**
     * Adapter class that converts the (Segment)Pen protocol to the
     * PointPen protocol.
     */
    function SegmentToPointPen(pointPen, guessSmooth) {
        Parent.call(this);
        if(guessSmooth)
            this.pen = new GuessSmoothPointPen(pointPen);
        else
            this.pen = pointPen;
        this.contour = null;
    }
    var _p = SegmentToPointPen.prototype = Object.create(Parent.prototype);
    _p.constructor = SegmentToPointPen;

    _p._flushContour = function() {
        var pen = this.pen, i,l, pt, segmentType;
        pen.beginPath();
        for(i=0,l=this.contour.length;i<l;i++) {
            pt = this.contour[i][0];
            segmentType = this.contour[i][1];
            pen.addPoint(pt, segmentType);
        }
        pen.endPath();
    };

    _p.moveTo = function(pt) {
        this.contour = [];
        this.contour.push([pt, 'move']);
    };

    _p.lineTo = function(pt) {
        this.contour.push([pt, 'line']);
    };

    _p.curveTo = function(/* *pts */) {
        var i,l,pt;
        for(i=0,l=arguments.length-1;i<l;i++) {
            pt = arguments[i];
            this.contour.push([pt, null]);
        }
        this.contour.push([arguments[arguments.length-1], 'curve']);
    };

    _p.qCurveTo = function(/* *pts */) {
        var i,l,pt;
        if(arguments[arguments.length-1] === null)
            this.contour = [];
        for(i=0,l=arguments.length-1;i<l;i++) {
            pt = arguments[i];
            this.contour.push([pt, null]);
        }
        if(arguments[arguments.length-1] !== null)
            this.contour.push([arguments[arguments.length-1], "qcurve"]);
    };

    _p.closePath = function() {
        var lastIndex = this.contour.length-1, pt, type;
        if(this.contour.length
                && this.contour[0][0][0] == this.contour[lastIndex][0][0]
                && this.contour[0][0][1] == this.contour[lastIndex][0][1]
        ) {
            this.contour[0] = this.contour[lastIndex];
            this.contour.pop();
        }
        else {
            // There's an implied line at the end, replace "move" with "line"
            // for the first point
            pt = this.contour[0][0];
            type = this.contour[0][1];
            if(type === 'move')
                this.contour[0] = [pt, 'line'];
        }
        this._flushContour();
        this.contour = null;
    };

    _p.endPath = function() {
        this._flushContour();
        this.contour = null;
    };

    _p.addComponent = function(glyphName, transform) {
        assert(this.contour === null, 'assertion: this.contour === null');
        this.pen.addComponent(glyphName, transform);
    };

    return SegmentToPointPen;

    })(AbstractPen, errors);

    var AbstractBarcodeGlyph = (function(errors) {

    var NotImplementedError = errors.NotImplemented;

    function AbstractBarcodeGlyph(name, targetChars, textBelowFlag) {
        this.name = name;
        this.targetCharCodes = targetChars.map(
                        function(char){ return char.charCodeAt(0);});
        this._parameters = null;
        this.textBelowFlag = textBelowFlag;
    }

    var _p = AbstractBarcodeGlyph.prototype;

    _p.setParameters = function(params) {
        this._parameters = params;
    };

    _p.drawPoints = function(parameters, pen) {
        // jshint unused:vars
        throw new NotImplementedError('drawPoints');
    };

    return AbstractBarcodeGlyph;
    })(errors);


    var ValidationError = errors.Validation
      , validate = validation.validate
      , ValueError = errors.Value
      ;

    function AbstractBarcodeBuilder() {
        this.glyphs = [];
        // the first argument passed to the glyphs drawPoints method
        this.parameters = null;
    }

    var _p = AbstractBarcodeBuilder.prototype;
    _p.constructor = AbstractBarcodeBuilder;
    _p._glyphData = null;
    _p._initGlyphs = function() {
        var i, l, glyph;
        for(i=0,l=this._glyphData.length;i<l;i++) {
            glyph = Object.create(this.BarcodeGlyphType.prototype);
            this.BarcodeGlyphType.apply(glyph, this._glyphData[i]);
            this.glyphs.push(glyph);
        }
    };

    _p.BarcodeGlyphType = AbstractBarcodeGlyph;

    _p._charcode2name = function (charcode) {
        // TODO: charcode2name is very missing
        // maybe later, use GlyphData.xml, or something with a similar
        // result but less implementation effort.
        // For now: use uniXXXX names, which is fine, since we don't
        // want to hand-edit these fonts.
        var hex = charcode.toString(16).toUpperCase()
          , padding = '0000'.slice(hex.length)
          ;
          return ['uni', padding, hex].join('');
    };

    _p._drawAddComponent = function (name, transformation, pen) {
        pen.addComponent( name, transformation || [1, 0, 0, 1, 0, 0] );
    };

    _p._makeGlyphBelowComponent = function(glyphSet, fontBelow, charcode
                                                        , transformation) {
        var glyph = fontBelow.glyphForCodePoint(charcode)
          , name = 'below-' + this._charcode2name(charcode)
            // only interested in the x movement to determine the new advanceWidth
          , advanceWidth = transformation.transformPoint([glyph.advanceWidth, 0])[0]
          , glifData = {
                unicodes: []
              , width: advanceWidth
            }
          ;
        function drawPointsFunc(pen) {
            var commands = glyph.path.commands
              , tpen = new TransformPointPen(pen, transformation)
              , s2pPen = new SegmentToPointPen(tpen)
              , i, l, command, args, points
              ;

            // segments to point pen
            for(i=0,l=commands.length;i<l;i++) {
                command = commands[i].command;
                args = commands[i].args;
                switch (command) {
                  case 'closePath':
                    s2pPen.closePath();
                    break;
                  case 'moveTo':
                    s2pPen.moveTo(args.slice(0,2));
                    break;
                  case 'lineTo':
                    s2pPen.lineTo(args.slice(0,2));
                    break;
                  case 'quadraticCurveTo':
                    points  = [];
                    args = args.slice();
                    while(args.length) {
                        points.push(args.slice(0,2));
                        args = args.slice(2);
                    }
                    s2pPen.qCurveTo.apply(s2pPen, points);
                    break;
                  case 'bezierCurveTo':
                    points  = [];
                    args = args.slice();
                    while(args.length) {
                        points.push(args.slice(0,2));
                        args = args.slice(2);
                    }
                    s2pPen.curveTo.apply(s2pPen, points);
                    break;
                  default:
                    throw new ValueError('Curve command "' +command+ '" unknown.');
                }
            }
        }

        glyphSet.writeGlyph(false, name, glifData, drawPointsFunc
                             , undefined // formatVersion
                             , {precision: -1} // make precision configurable?
                             );
        return {name: name, advanceWidth: advanceWidth};
    };

    _p._makeComponent = function (glyphSet, component, fontBelow, charcode) {
        var name = this._charcode2name(charcode)
          , glifData = {
                unicodes: [charcode]
              , width: component.width
            }
          , drawPointsFunc = function(name, pen) {
                // jshint: validthis: true
                var glyph, height, scale, transformation;
                this._drawAddComponent(name, null, pen);
                if(!fontBelow || !fontBelow.hasGlyphForCodePoint(charcode))
                    return;
                // Using height to calculate the scale is good, because
                // it creates the same scaling for all of the font.
                // This results in the new height fitting into fontBelowHeight
                // units after scaling.
                height = fontBelow['OS/2'].typoAscender
                                    - fontBelow['OS/2'].typoDescender;
                scale = this.parameters.fontBelowHeight / height;

                // Make the skaling transformation and also changing
                // the advance width earlier, directly in the original drawing
                // (did use only the transformation of the component earlier),
                // otherwise, very huge fonts will screw the calculations
                // of average glyph width and such.
                transformation = new Transform().scale(scale);
                glyph = this._makeGlyphBelowComponent(glyphSet, fontBelow
                                                , charcode, transformation);


                transformation = new Transform()
                        .translate(
                                // center using advance width, so the spacing
                                // of the giving font still has some influence
                                // which is rather good.
                                (component.width - glyph.advanceWidth) / 2
                                // move down just the amount of the ascender
                                // that is still left.
                              , -fontBelow['OS/2'].typoAscender * scale
                        );

                this._drawAddComponent(glyph.name, transformation, pen);
            }.bind(this, component.name)
          ;

        glyphSet.writeGlyph(false, name, glifData, drawPointsFunc
                             , undefined // formatVersion
                             , {precision: -1} // make precision configurable?
                             );
    };

    _p.populateGlyphSet = function(glyphSet, fontBelow) {
        var i, l, glyph, drawPointsFunc;
        for(i=0,l=this.glyphs.length;i<l;i++) {
            glyph = this.glyphs[i];
            glyph.setParameters(this.parameters);

            drawPointsFunc = glyph.drawPoints.bind(glyph);
            glyphSet.writeGlyph(false, glyph.name, glyph.glifData
                             , drawPointsFunc
                             , undefined // formatVersion
                             , {precision: -1} // make precision configurable?
                             );

            // now create all the compound glyphs
            glyph.targetCharCodes
                .forEach(this._makeComponent.bind(this, glyphSet, glyph
                            , glyph.textBelowFlag ? fontBelow : undefined));
        }
    };

    _p._defaultParameters = {
        // At the momemnt generic to all barcode fonts:
        force: false // ignore validation problems and just run
      , bottom: 0
      , top: 590
      , fontBelowHeight: 390
    };

    _p._validators = [
        function checkBottom(params) {
            validation.validateNumber('bottom', params.bottom);
        }
      , function checkTop(params) {
            validation.validateNumber('top', params.top);
            if(params.top <= params.bottom)
                throw new ValidationError('"top" must be bigger than bottom.');
        }
      , function checkFontBelowHeight(params) {
            validation.validatePositiveNumber('fontBelowHeight', params.fontBelowHeight);
        }
    ];

    _p._validateParameters = function(userParameters) {
        return validate.call(this, this._validators, this._defaultParameters, userParameters);
    };

    _p.reportParameters = function(logger) {
        var i, l, keys, key, value, isDefault;
        keys = [];
        for(key in this.parameters)
            keys.push(key);
        keys.sort();
        logger = logger || console;
        logger.log('Got following parameters for ' + this.constructor.name + ':');
        for(i=0,l=keys.length;i<l;i++) {
            key = keys[i];
            value = this.parameters[key];
            isDefault = (key in this._defaultParameters
                                && this._defaultParameters[key] === value);
            logger.log('  ' + key + ':'
                                , value + (isDefault ? '(default)' : ''));
        }
    };

    return {
        BarcodeBuilder: AbstractBarcodeBuilder
      , BarcodeGlyph: AbstractBarcodeGlyph
    };
});

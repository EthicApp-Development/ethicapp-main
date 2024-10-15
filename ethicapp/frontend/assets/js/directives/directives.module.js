import { MatchFieldDirective } from "match-field.directive.js";

// directives.module.js
export let CustomDirectives = angular.module('app.directives', [])
  .directive('matchField', MatchFieldDirective);
  //.directive('anotherDirective', anotherDirective);
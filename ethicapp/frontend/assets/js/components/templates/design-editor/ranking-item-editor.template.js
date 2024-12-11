const rankingItemEditorTemplate = 
`                <input type="text" class="form-control" 
                        placeholder="{{ 'item_input_placeholder_text' | translate }}" 
                        ng-model="item.name">
                <ng-transclude></ng-transclude>
`;

export default rankingItemEditorTemplate;